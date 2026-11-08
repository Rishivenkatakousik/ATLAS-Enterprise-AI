import re
from app.observability import trace
from typing import TypedDict,Any
from langgraph.graph import StateGraph,START,END
from app.aws import embed,answer
from app.vector import search,document_pages
from app.config import settings
from app.guardrails import check_input,check_output
from app.memory import user_questions,last_cited_document


class State(TypedDict,total=False):
    question:str
    principal:Any
    conversation_id:Any
    intent:str
    passages:list
    answer:str
    sources:list
    status:str
    history:list


# Questions about the chat itself ("what have I asked so far?"). These are answered
# from the stored conversation, not from document retrieval.
HISTORY_Q=re.compile(r"""
    \b(questions?|things|stuff)\b.{0,40}\b(i|i've|i\ have|i\ had)\b.{0,15}\b(ask|asked)\b
  | \bwhat\ (did|have)\ i\ (just\ |already\ )?(ask|asked)\b
  | \b(my|the)\ (previous|last|earlier|first|prior)\ (questions?|messages?)\b
  | \b(this|our)\ (conversation|chat)\ (so\ far|history)\b
  | \b(conversation|chat)\ history\b
""",re.I|re.X)

# Questions about a document's identity (authors, title, abstract...). That information
# lives on page 1, which semantic search ranks poorly for queries like "who are the authors".
DOC_META_Q=re.compile(r"""
    \b(authors?|authored|wrote|written\ by|co-?authors?|affiliations?|institutions?)\b
  | \b(title|abstract|published|publication\ (date|year)|venue)\b
  | \bwhat\ is\ (this|the)\ (paper|document|pdf|file|article)\ about\b
  | \b(summari[sz]e|summary\ of|overview\ of)\ (this|the)\ (paper|document|pdf|file|article)\b
""",re.I|re.X)


@trace("guard")
def guard(s):
    q=check_input(s['question'])
    intent='history' if HISTORY_Q.search(q) else 'doc_meta' if DOC_META_Q.search(q) else 'search'
    return {'question':q,'intent':intent}


def route_intent(s): return 'recall' if s.get('intent')=='history' else 'retrieve'


@trace("recall")
def recall(s):
    p=s['principal']
    cid=s.get('conversation_id')
    asked=user_questions(p.tenant,cid) if cid else [m['content'] for m in s.get('history',[]) if m['role']=='user']
    if not asked:
        return {'answer':'You have not asked any questions in this conversation yet.','sources':[],'status':'answered'}
    lines='\n'.join(f'{i}. {q}' for i,q in enumerate(asked,1))
    n=len(asked)
    return {'answer':f'Here {"is the question" if n==1 else f"are the {n} questions"} you have asked in this conversation so far:\n\n{lines}',
            'sources':[],'status':'answered'}


def _source(i,h):
    return {'index':i+1,'document_id':h['metadata'].get('document_id',''),'title':h['metadata'].get('title',''),
            'page':h['metadata'].get('page',1),'excerpt':h['metadata'].get('text','')[:320],'score':round(float(h['score']),3)}


@trace("retrieve")
def retrieve(s):
    p=s['principal']
    # Include the most recent user question for short follow-ups such as 'summarize that'.
    prior_questions=[m['content'] for m in s.get('history',[]) if m['role']=='user']
    query=(prior_questions[-1]+'\nFollow-up: '+s['question']) if prior_questions else s['question']
    vec=embed(query)
    raw=search(p.tenant,vec,p.groups,p.subject)
    hits=[h for h in raw if h['score']>=settings().min_relevance]
    if s.get('intent')=='doc_meta':
        # Resolve "this paper": the document the conversation was last grounded in,
        # otherwise the document of the best raw match (even if below threshold).
        cid=s.get('conversation_id')
        doc_id=(last_cited_document(p.tenant,cid) if cid else None) or \
               (raw[0]['metadata'].get('document_id') if raw else None)
        if doc_id:
            front=document_pages(p.tenant,vec,doc_id,p.groups,p.subject,pages=(1,),limit=3)
            # Keep reading order (chunk ids end in ':<n>'): the title/author block is the
            # first chunk but scores lowest semantically, so score order would bury it.
            front.sort(key=lambda h:int(h['id'].rsplit(':',1)[-1]) if h['id'].rsplit(':',1)[-1].isdigit() else 0)
            seen={h['id'] for h in front}
            # Page-1 passages first (they hold title/authors), then any relevant hits.
            hits=front+[h for h in hits if h['id'] not in seen]
    return {'passages':hits,'sources':[_source(i,h) for i,h in enumerate(hits)]}



def route(s): return 'generate' if s['passages'] else 'no_evidence'


@trace("no_evidence")
def no_evidence(s): return {'answer':'I could not find supporting evidence in documents you are authorized to access.','status':'no_evidence'}



@trace("generate")
def generate(s):
    evidence='\n\n'.join(f'[{i+1}] {h["metadata"].get("title", "Document")}, page {h["metadata"].get("page",1)}: {h["metadata"].get("text", "")}' for i,h in enumerate(s['passages']))
    text=answer(s['question'],evidence,s.get('history',[]))
    # Show only the passages the answer actually cites. If it cites none, keep them all
    # so the answer is never presented as ungrounded.
    cited={int(n) for n in re.findall(r'\[(\d+)\]',text)}
    sources=[x for x in s.get('sources',[]) if x['index'] in cited] or s.get('sources',[])
    return {'answer':text,'sources':sources,'status':'answered'}



@trace("validate")
def validate(s): return {'answer':check_output(s['answer'])}



def make_graph():
    g=StateGraph(State)
    for name,fn in [('guard',guard),('recall',recall),('retrieve',retrieve),('no_evidence',no_evidence),('generate',generate),('validate',validate)]:g.add_node(name,fn)
    g.add_edge(START,'guard')
    g.add_conditional_edges('guard',route_intent,{'recall':'recall','retrieve':'retrieve'})
    g.add_edge('recall','validate')
    g.add_conditional_edges('retrieve',route,{'generate':'generate','no_evidence':'no_evidence'})
    g.add_edge('generate','validate');g.add_edge('validate',END);g.add_edge('no_evidence',END)
    return g.compile()



graph=make_graph()



@trace("chat")
def chat(p,question,history=None,conversation_id=None):
    r=graph.invoke({'principal':p,'question':question,'history':history or [],'conversation_id':conversation_id})
    return {'answer':r['answer'],'sources':r.get('sources',[]),'status':r.get('status','answered')}
