from app.schemas.regulatory import RegulatoryDocument, content_hash
from app.services.pipeline import Scan


def _doc(content: str, doc_id: str = "104387") -> RegulatoryDocument:
    return RegulatoryDocument(source="SEBI", jurisdiction="IN", document_id=doc_id, title="t", url="https://x", content=content).with_hash()


def test_hash_ignores_whitespace_only_changes():
    assert content_hash("a  b\nc") == content_hash("a b c")
    assert content_hash("a b c") != content_hash("a b d")


def test_same_hash_is_skipped_and_new_hash_is_new_version(db, tenant):
    scan = Scan(db, tenant, llm=_NoLLM(), ret=_NoRet())
    first = scan.detect(_doc("original text"))
    assert first is not None and first.document_version == 1 and first.status == "DISCOVERED"
    db.update_document(first.id, status="ARCHIVED")  # reached a decision
    assert scan.detect(_doc("original   text")) is None  # duplicate → skip
    v2 = scan.detect(_doc("changed text"))
    assert v2 is not None and v2.document_version == 2 and v2.previous_hash == first.content_hash
    kinds = [e.event_type for e in db.list_audit(tenant.tenant_id)]
    assert {"DOCUMENT_DETECTED", "DOCUMENT_SKIPPED", "DOCUMENT_VERSION_DETECTED"} <= set(kinds)


def test_force_reuses_row_instead_of_duplicating(db, tenant):
    scan = Scan(db, tenant, llm=_NoLLM(), ret=_NoRet(), force=True)
    a = scan.detect(_doc("x"))
    b = scan.detect(_doc("x"))
    assert a and b and a.id == b.id
    assert len(db.list_documents(tenant.tenant_id)) == 1


class _NoLLM:
    name = "none"


class _NoRet:
    name = "none"


def test_unfinished_document_is_retried_not_skipped(db, tenant):
    scan = Scan(db, tenant, llm=_NoLLM(), ret=_NoRet())
    a = scan.detect(_doc("x"))
    db.update_document(a.id, status="FAILED", error="boom")
    b = scan.detect(_doc("x"))
    assert b is not None and b.id == a.id and b.status == "DISCOVERED"
    db.update_document(a.id, status="ARCHIVED")
    assert scan.detect(_doc("x")) is None
