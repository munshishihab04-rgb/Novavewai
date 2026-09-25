from pathlib import Path
import json
import re
import hashlib

root = Path('/home/azureuser/nova-community-agent')
out = root / 'evidence/context-review-2'
expected = {
    'permanent-idempotency': (9, 9, 0),
    'corrected-r1': (1, 1, 0),
    'unaffected-controls': (6, 6, 0),
    'baseline-corrected-r1-red': (1, 0, 1),
    'auth-revalidation': (12, 12, 0),
}
results = [json.loads(line) for line in (out / 'results.jsonl').read_text().splitlines()]
for result in results:
    text = (out / (result['name'] + '.log')).read_text()
    result['counts'] = {key: int(value) for key, value in re.findall(r'^(?:#|ℹ) (tests|pass|fail|skipped|cancelled) (\d+)$', text, re.M)}
    assert result['matches_expected']
    if result['name'] in expected:
        assert tuple(result['counts'][k] for k in ['tests', 'pass', 'fail']) == expected[result['name']]
        assert result['counts']['skipped'] == result['counts']['cancelled'] == 0
(out / 'verified-results.json').write_text(json.dumps(results, indent=2) + '\n')
cleanup = json.loads((out / 'cleanup-and-preservation.json').read_text())
assert cleanup['protected_files_unchanged'] and not cleanup['temporary_files_remaining'] and not cleanup['owned_processes_remaining']
comparison = json.loads((out / 'baseline-comparison.json').read_text())
assert comparison['changed_snapshot_files'] == ['src/app.ts', 'src/files.ts']
current = (root / 'src/app.ts').read_text()
baseline = (root / 'evidence/context-fix-1/baseline/src/app.ts').read_text()
for start, end in [ ('export async function active(', 'export async function event('), ('export async function authenticatedOwner(', '\n}') ]:
    extract = lambda text: text[text.index(start):text.index(end, text.index(start))]
    assert extract(current) == extract(baseline)
finalization_start = '    const result = await transaction(pool, async c => {'
assert (root / 'src/files.ts').read_text().split(finalization_start, 1)[1] == (root / 'evidence/context-fix-1/baseline/src/files.ts').read_text().split(finalization_start, 1)[1]
verdict = {
    'passed': True,
    'security_concerns': [],
    'logic_errors': [],
    'suggestions': [],
    'summary': 'R1 chiuso: approvata la slice circoscritta context/messages/provenance/files di NEW Nova; consentito proseguire con lo sviluppo agent core. Non costituisce approvazione completa J0 o produzione.',
    'scope': 'Independent bounded re-review of R1 shared owner-key upload namespace fix and existing context integration controls only.',
    'baseline': 'evidence/context-fix-1/baseline (pre-fix context snapshot); accepted prior base 75e1600',
    'source_review': {
        'changed_files_vs_snapshot': comparison['changed_snapshot_files'],
        'common_lookup': 'src/app.ts:60-69 and 86-96: completed responses and durable files.request_key checked under authenticated owner-row lock before every generic mutate callback; wired to context/provenance/actions at 153-157. src/files.ts:35-44 applies the identical lookup before reservation.',
        'finalization': 'src/files.ts:48-56 is unchanged: reacquire authenticated owner lock, verify the exact reserved UUID is still pending BEFORE put, revalidate exact session AFTER put, atomically commit ready/event/cache. It intentionally does not call the pending-rejecting helper on its own reservation. Shared lookup at reservation and every competing generic mutation preserves key ownership throughout the gap; cancelled UUIDs cannot finalize a replacement.',
        'recovery': 'src/file-lifecycle.ts:13-20 deletes owner-scoped pending reservations and UUID-scoped cleanup only, not completed cache by key. src/privacy.ts:30-45 purges only the authenticated owner. DB/FS failure, recovery retry, old-request/replacement and legacy-collision cases passed.',
        'auth': 'Owner active lock, exact token/owner/clock_timestamp revalidation, onRequest authentication, upload finalization and filesystem read rechecks unchanged. Twelve original auth-revalidation tests and exact-session after-read control passed.',
        'schema': 'All baseline migrations byte-identical; existing files(owner_id,request_key) unique constraint and completed idempotency(owner_id,key) primary key retained. No new cross-table SQL constraint claimed.'
    },
    'verification': results,
    'independent_reproduction': {
        'source': 'evidence/context-review-1/review.test.ts preserved unchanged',
        'adapted_test': 'evidence/context-review-2/corrected-review.test.ts',
        'adaptation_diff': 'evidence/context-review-2/adaptation.diff',
        'corrected_observation': 'Competing conversation 409 idempotency_conflict; original upload 201 ready; one conversation, file/blob/cache and file.ready event; exact 201 replay and file persistence after real PostgreSQL/application restart; actual content download verified.',
        'negative_control': 'Identical corrected assertions against pre-fix snapshot failed exactly at expected409 versus actual201; original upload500/pending/cache collision observed. This is an expected negative control, not an acceptance pass.'
    },
    'preservation_and_cleanup': cleanup,
    'limitations': [
        'Existing documented single-active-instance local encrypted development adapter boundary retained. R2 is one of the six unaffected controls, not a reopened blocker.',
        'No cloud/KMS/providers/UI/voice, distributed coordination, production readiness or full J0 approval.',
        'Only selected tests independently rerun here: nine permanent R1, one corrected original reproduction, six unaffected controls and twelve auth tests. Parent-reported 48/48 is not presented as this reviewer\'s execution.',
        'No implementation/test/original-evidence edits, commits, legacy access, installs or external calls.'
    ],
    'harness_notes': ['Initial count parser expected TAP # lines but Node emitted spec reporter ℹ lines. Raw successful logs preserved; evidence-only parser corrected and exact counts reparsed with assertions in finalize.py. No application failure.', 'First cleanup verification found only reviewer-owned Node/tsx compilation caches, no fixture DB/blob roots or processes. Initial inventory preserved in cleanup-before-cache-removal.json; caches removed and clean verification rerun successfully.'],
    'files_created': 'Only evidence/context-review-2/*; hashes, baseline diff, corrected evidence tests, execution logs, exact commands, verified results, preservation/cleanup and report.'
}
(out / 'verdict.json').write_text(json.dumps(verdict, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'passed': verdict['passed'], 'acceptance_and_control_passes': sum(r['counts'].get('pass', 0) for r in results), 'expected_baseline_failures': 1, 'protected_files_unchanged': True}, ensure_ascii=False))
