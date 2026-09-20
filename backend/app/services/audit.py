from typing import Any, Literal

from app.schemas.actions import AuditEvent, AuditEventType
from app.services.state import StateStore, new_id, now


def record(
    db: StateStore,
    tenant_id: str,
    event_type: AuditEventType,
    *,
    actor: str = "aftercircular",
    actor_type: Literal["agent", "human", "system"] = "agent",
    document_pk: str | None = None,
    analysis_id: str | None = None,
    scan_id: str | None = None,
    **metadata: Any,
) -> AuditEvent:
    return db.audit(AuditEvent(id=new_id("evt"), tenant_id=tenant_id, timestamp=now(), actor=actor, actor_type=actor_type,
                               event_type=event_type, document_pk=document_pk, analysis_id=analysis_id, scan_id=scan_id, metadata=metadata))
