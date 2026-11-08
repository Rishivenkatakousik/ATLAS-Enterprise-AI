import uuid
from psycopg.types.json import Jsonb
from app.db import connection
from app.config import settings

def history(tenant: str, conversation_id: uuid.UUID):
    with connection() as conn:
        rows = conn.execute("""SELECT role,content FROM (
            SELECT id,role,content,created_at FROM chat_messages
            WHERE tenant_id=%s AND conversation_id=%s ORDER BY id DESC LIMIT %s
        ) recent ORDER BY id ASC""", (tenant,conversation_id,settings().memory_turns*2)).fetchall()
    return rows

def save_turn(tenant: str, conversation_id: uuid.UUID, question: str, response: str, sources=None):
    """Store the question, the answer and the passages the answer was grounded in."""
    with connection() as conn:
        conn.execute("""INSERT INTO chat_messages(tenant_id,conversation_id,role,content,sources)
                        VALUES (%s,%s,'user',%s,NULL),(%s,%s,'assistant',%s,%s)""",
                     (tenant,conversation_id,question,tenant,conversation_id,response,Jsonb(sources or [])))

def list_conversations(tenant: str, limit: int = 50):
    """Recent conversations, titled by their first user question."""
    with connection() as conn:
        return conn.execute("""SELECT c.conversation_id, f.content AS title, c.last_at
          FROM (SELECT conversation_id, min(id) AS first_id, max(created_at) AS last_at
                FROM chat_messages WHERE tenant_id=%s GROUP BY conversation_id) c
          JOIN chat_messages f ON f.id=c.first_id
          ORDER BY c.last_at DESC LIMIT %s""", (tenant, limit)).fetchall()

def list_messages(tenant: str, conversation_id: uuid.UUID):
    with connection() as conn:
        return conn.execute("""SELECT role,content,sources,created_at FROM chat_messages
          WHERE tenant_id=%s AND conversation_id=%s ORDER BY id ASC LIMIT 100""",
          (tenant,conversation_id)).fetchall()

def user_questions(tenant: str, conversation_id: uuid.UUID, limit: int = 200):
    """Every question the user asked in this conversation, oldest first."""
    with connection() as conn:
        rows = conn.execute("""SELECT content FROM chat_messages
          WHERE tenant_id=%s AND conversation_id=%s AND role='user' ORDER BY id ASC LIMIT %s""",
          (tenant, conversation_id, limit)).fetchall()
    return [r['content'] for r in rows]

def last_cited_document(tenant: str, conversation_id: uuid.UUID):
    """document_id of the top source cited by the most recent grounded answer, if any."""
    with connection() as conn:
        row = conn.execute("""SELECT sources->0->>'document_id' AS document_id FROM chat_messages
          WHERE tenant_id=%s AND conversation_id=%s AND role='assistant'
            AND jsonb_array_length(COALESCE(sources,'[]'::jsonb))>0
          ORDER BY id DESC LIMIT 1""", (tenant, conversation_id)).fetchone()
    return row['document_id'] if row and row['document_id'] else None
