import psycopg2, uuid, sys, subprocess
HOST, DB = '127.0.0.1', 'crm_test'
def U(): return str(uuid.uuid4())
def su_conn(): return psycopg2.connect(dbname=DB, user='postgres', password='pw', host=HOST)
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (('  -> ' + str(detail)) if not cond else ''))

# ---------------- seed (as superuser) ----------------
su = su_conn(); cur = su.cursor()
cur.execute("INSERT INTO deployment_info(region) VALUES ('ca-qc')")
T, T2 = U(), U()
for t, n in ((T, 'Tenant CA'), (T2, 'Other CA tenant')):
    cur.execute("INSERT INTO tenants(id,name,country_code,region) VALUES (%s,%s,'CA','ca-qc')", (t, n))
    cur.execute("INSERT INTO tenant_settings(tenant_id) VALUES (%s)", (t,))
N = {k: U() for k in ['R','X','Y','P1','P2','P3','S1','S2','R2']}
types = {'R':'tenant','X':'location','Y':'location','P1':'partner','P2':'partner','P3':'partner','S1':'partner','S2':'partner','R2':'tenant'}
for k, i in N.items():
    cur.execute("INSERT INTO org_nodes(id,tenant_id,type,name) VALUES (%s,%s,%s,%s)", (i, T2 if k=='R2' else T, types[k], k))
def link(a, b, kind, t=T):
    cur.execute("INSERT INTO org_links(tenant_id,parent_id,child_id,kind) VALUES (%s,%s,%s,%s)", (t, N[a], N[b], kind))
for a, b in (('X','P1'),('X','P2'),('X','P3'),('Y','P3')): link(a, b, 'location_link')
for a, b in (('P3','S1'),('P3','S2')): link(a, b, 'partner_link')

UID, EMAIL_HOME = {}, {'admin':'R','mgrX':'X','mgrY':'Y','u1':'P1','u2':'P2','u3':'P3','s1':'S1','s2':'S2','out':'R2'}
for k, home in EMAIL_HOME.items():
    UID[k] = U()
    cur.execute("INSERT INTO app_users(id,tenant_id,email,home_node_id,status) VALUES (%s,%s,%s,%s,'active')",
                (UID[k], T2 if k=='out' else T, k+'@example.com', N[home]))
CTX = {k: dict(tenant=T2 if k=='out' else T, user=UID[k], nodes=[N[EMAIL_HOME[k]]], admin=(k=='admin'), write=True) for k in UID}

PL, ST = U(), U()
cur.execute("INSERT INTO pipelines(id,tenant_id,owner_node_id,name,is_shared_down) VALUES (%s,%s,%s,'Sales',true)", (PL, T, N['R']))
cur.execute("INSERT INTO stages(id,tenant_id,pipeline_id,name,position) VALUES (%s,%s,%s,'New',1)", (ST, T, PL))
BOX = {}
for name, owner, ctxn in (('b1','P1','X'),('b2','P2','X'),('b3','P3','X'),('b4','P3','Y'),('b5','S1','X'),('b6','S2','Y')):
    BOX[name] = U()
    cur.execute("INSERT INTO boxes(id,tenant_id,pipeline_id,stage_id,owner_node_id,context_node_id,name) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                (BOX[name], T, PL, ST, N[owner], N[ctxn], name))
    cur.execute("INSERT INTO contacts(tenant_id,owner_node_id,context_node_id,email,full_name) VALUES (%s,%s,%s,%s,%s)",
                (T, N[owner], N[ctxn], name+'@client.com', 'contact-'+name))
GM = {}
for k in ('u1','u2','u3'):
    GM[k] = U()
    cur.execute("INSERT INTO gmail_accounts(id,tenant_id,user_id,email,refresh_token_enc,key_id,scopes) VALUES (%s,%s,%s,%s,'\\x00','k1',ARRAY['gmail.modify'])", (GM[k], T, UID[k], k+'@gmail.com'))
    cur.execute("INSERT INTO snippets(tenant_id,user_id,name,body) VALUES (%s,%s,%s,'hi')", (T, UID[k], 'snip-'+k))
    cur.execute("INSERT INTO scheduled_sends(tenant_id,user_id,gmail_account_id,mime_enc,key_id,send_at) VALUES (%s,%s,%s,'\\x00','k1',now())", (T, UID[k], GM[k]))
TH = {}
for k, own in (('u1','P1'),('u2','P2')):
    TH[k] = U()
    cur.execute("INSERT INTO email_threads(id,tenant_id,gmail_account_id,owner_node_id,gmail_thread_id,subject) VALUES (%s,%s,%s,%s,%s,%s)", (TH[k], T, GM[k], N[own], 'g-'+k, 'subject-'+k))
cur.execute("INSERT INTO consent_records(id,tenant_id,user_id,kind,notice_version,locale,region) VALUES (%s,%s,%s,'link_thread','v1','fr-CA','ca-qc') RETURNING id", (U(), T, UID['u1']))
CONSENT = cur.fetchone()[0]
cur.execute("INSERT INTO box_threads(box_id,thread_id,tenant_id,linked_by,consent_id) VALUES (%s,%s,%s,%s,%s)", (BOX['b1'], TH['u1'], T, UID['u1'], CONSENT))
cur.execute("INSERT INTO linked_thread_messages(tenant_id,thread_id,gmail_message_id,body_enc,key_id) VALUES (%s,%s,'m1','\\x00','k1')", (T, TH['u1']))
# LMS
C0, CD = U(), U()
cur.execute("INSERT INTO courses(id,tenant_id,owner_node_id,status) VALUES (%s,%s,%s,'published')", (C0, T, N['R']))
cur.execute("INSERT INTO course_locales(course_id,tenant_id,locale,title,is_published) VALUES (%s,%s,'en','Onboarding',true)", (C0, T))
cur.execute("INSERT INTO courses(id,tenant_id,owner_node_id,status) VALUES (%s,%s,%s,'draft')", (CD, T, N['P1']))
ASG = U()
cur.execute("INSERT INTO course_assignments(id,tenant_id,course_id,node_id) VALUES (%s,%s,%s,%s)", (ASG, T, C0, N['X']))
su.commit()
g = su_conn(); g.autocommit = True; gc = g.cursor()
gc.execute("SELECT 1 FROM pg_roles WHERE rolname='app_runtime'")
if not gc.fetchone(): gc.execute("CREATE ROLE app_runtime LOGIN PASSWORD 'pw' NOBYPASSRLS")
gc.execute("GRANT USAGE ON SCHEMA public TO app_runtime")
gc.execute("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO app_runtime")
g.close()

# ---------------- runtime helper (as app_runtime, RLS enforced) ----------------
def run(ctxname, sql, params=()):
    c = CTX[ctxname] if ctxname else None
    con = psycopg2.connect(dbname=DB, user='app_runtime', password='pw', host=HOST); cu = con.cursor()
    if c:
        cu.execute("SELECT set_config('app.tenant_id',%s,false), set_config('app.user_id',%s,false), set_config('app.node_ids',%s,false), set_config('app.is_tenant_admin',%s,false), set_config('app.can_write',%s,false)",
                   (c['tenant'], c['user'], '{'+','.join(c['nodes'])+'}', str(c['admin']).lower(), str(c['write']).lower()))
    try:
        cu.execute(sql, params)
        rows = cu.fetchall() if cu.description else []
        n = cu.rowcount; con.commit(); return rows, n, None
    except Exception as e:
        con.rollback(); return [], 0, e
    finally: con.close()
def names(ctxname, sql): return sorted(r[0] for r in run(ctxname, sql)[0])

print('\n== 1-3. CRM visibility ==')
exp = {'u1':['b1'],'u2':['b2'],'u3':['b3','b4','b5','b6'],'s1':['b5'],'s2':['b6'],
       'mgrX':['b1','b2','b3','b5'],'mgrY':['b4','b6'],'admin':['b1','b2','b3','b4','b5','b6']}
for k, v in exp.items():
    got = names(k, "SELECT name FROM boxes ORDER BY name")
    check(f"boxes visible to {k} = {v}", got == v, got)
    got = names(k, "SELECT full_name FROM contacts ORDER BY full_name")
    check(f"contacts visible to {k}", got == ['contact-'+b for b in v], got)
check("sibling partners isolated (u1 sees none of u2's contacts)", 'contact-b2' not in names('u1', "SELECT full_name FROM contacts"))
check("sibling sub-partners isolated (s1 does not see s2)", 'b6' not in names('s1', "SELECT name FROM boxes"))
check("multi-location: mgrX cannot see work marked for Y", 'b4' not in names('mgrX', "SELECT name FROM boxes"))

print('\n== 3b. Families (Gate A): same wall as the Head\'s client record ==')
fs = su_conn(); fc = fs.cursor()
def contact_id(full_name):
    fc.execute("SELECT id FROM contacts WHERE full_name=%s", (full_name,)); return fc.fetchone()[0]
SPOUSE = U()
fc.execute("INSERT INTO contacts(id,tenant_id,owner_node_id,context_node_id,email,full_name) VALUES (%s,%s,%s,%s,'sp@client.com','contact-b1-spouse')", (SPOUSE, T, N['P1'], N['X']))
FAM = {'F1': ('P1', 'X', [('contact-b1', 'head'), ('contact-b1-spouse', 'spouse_partner')]), 'F5': ('S1', 'X', [('contact-b5', 'head')]), 'F4': ('P3', 'Y', [('contact-b4', 'head')])}
for fname, (own, ctxn, members) in FAM.items():
    fid = U()
    fc.execute("INSERT INTO families(id,tenant_id,owner_node_id,context_node_id,display_name) VALUES (%s,%s,%s,%s,%s)", (fid, T, N[own], N[ctxn], fname))
    for cname, role in members:
        fc.execute("INSERT INTO family_memberships(tenant_id,family_id,contact_id,role) VALUES (%s,%s,%s,%s)", (T, fid, contact_id(cname), role))
    FAM[fname] = fid
fc.execute("INSERT INTO person_relationships(tenant_id,person_a_id,person_b_id,kind) VALUES (%s,LEAST(%s::uuid,%s::uuid),GREATEST(%s::uuid,%s::uuid),'spouse_partner')",
           (T, contact_id('contact-b1'), SPOUSE, contact_id('contact-b1'), SPOUSE))
fs.commit()
fexp = {'u1': ['F1'], 'u2': [], 'u3': ['F4', 'F5'], 's1': ['F5'], 's2': [], 'mgrX': ['F1', 'F5'], 'mgrY': ['F4'], 'admin': ['F1', 'F4', 'F5'], 'out': []}
for k, v in fexp.items():
    got = names(k, "SELECT display_name FROM families")
    check(f"families visible to {k} = {v}", got == v, got)
mexp = {'u1': 2, 'u2': 0, 's1': 1, 's2': 0, 'mgrX': 3, 'mgrY': 1, 'out': 0}
for k, v in mexp.items():
    n = len(run(k, "SELECT 1 FROM family_memberships")[0])
    check(f"family members visible to {k} = {v}", n == v, n)
check("relationship visible to u1", len(run('u1', "SELECT 1 FROM person_relationships")[0]) == 1)
check("relationship hidden from sibling u2", len(run('u2', "SELECT 1 FROM person_relationships")[0]) == 0)
check("relationship hidden from other tenant", len(run('out', "SELECT 1 FROM person_relationships")[0]) == 0)
_, _, e = run('u2', "INSERT INTO family_memberships(tenant_id,family_id,contact_id,role) VALUES (%s,%s,%s,'other')", (T, FAM['F1'], contact_id('contact-b2')))
check("sibling u2 cannot add its client to u1's family", e is not None)
_, _, e = run('u1', "INSERT INTO family_memberships(tenant_id,family_id,contact_id,role) VALUES (%s,%s,%s,'other')", (T, FAM['F1'], contact_id('contact-b2')))
check("u1 cannot add a sibling's client to its family", e is not None)
_, n, e = run('u2', "UPDATE families SET display_name='taken' WHERE id=%s", (FAM['F1'],))
check("sibling u2 cannot rename u1's family (0 rows)", e is None and n == 0, (n, e))
_, _, e = run('u1', "INSERT INTO family_memberships(tenant_id,family_id,contact_id,role) VALUES (%s,%s,%s,'head')", (T, FAM['F1'], SPOUSE))
check("one active family per person (second membership refused)", e is not None)
fc.execute("SELECT count(*) FROM family_memberships WHERE family_id=%s AND role='head' AND ended_at IS NULL", (FAM['F1'],))
check("exactly one Head in F1", fc.fetchone()[0] == 1)

print('\n== 3c. Families Gate B: policies reachable only on the CRM wall ==')
POL = {}
for pname, prod, br in (('pol-P1', 'P1', 'X'), ('pol-P2', 'P2', 'X'), ('pol-P3Y', 'P3', 'Y')):
    POL[pname] = U()
    fc.execute("""INSERT INTO policy_records(id,tenant_id,branch_node_id,producer_node_id,carrier_id,policy_number,plan_name,jurisdiction,
                  annual_premium_cents,modal_premium_cents,premium_frequency,effective_date) VALUES (%s,%s,%s,%s,'ia-financial-group',%s,'Plan','CA-ON',100,100,'annual','2025-01-01')""",
               (POL[pname], T, N[br], N[prod], pname))
fc.execute("INSERT INTO policy_parties(tenant_id,policy_id,contact_id,role) VALUES (%s,%s,%s,'owner')", (T, POL['pol-P1'], contact_id('contact-b1')))
fc.execute("INSERT INTO policy_parties(tenant_id,policy_id,contact_id,role) VALUES (%s,%s,%s,'owner')", (T, POL['pol-P3Y'], contact_id('contact-b4')))
fs.commit()
pexp = {'u1': 1, 'u2': 0, 'u3': 1, 'mgrX': 1, 'mgrY': 1, 'admin': 2, 'out': 0, 's1': 0}
for k, v in pexp.items():
    n = len(run(k, "SELECT 1 FROM policy_parties")[0])
    check(f"policy parties visible to {k} = {v}", n == v, n)
check("u2 cannot see u1's policy through policy_visible", run('u2', "SELECT policy_visible(%s)", (POL['pol-P1'],))[0][0][0] is False)
_, _, e = run('u2', "INSERT INTO policy_parties(tenant_id,policy_id,contact_id,role) VALUES (%s,%s,%s,'insured')", (T, POL['pol-P1'], contact_id('contact-b2')))
check("sibling u2 cannot put its client on u1's policy", e is not None)
_, _, e = run('u1', "INSERT INTO policy_parties(tenant_id,policy_id,contact_id,role) VALUES (%s,%s,%s,'insured')", (T, POL['pol-P2'], contact_id('contact-b1')))
check("u1 cannot put its client on a sibling's policy", e is not None)

print('\n== 3d. Families Gate C: consents, authority, ID, life events and reviews stay on the CRM wall ==')
B1 = contact_id('contact-b1')
fc.execute("SELECT id FROM boxes WHERE name='b1'"); BOX1 = fc.fetchone()[0]
fc.execute("SELECT set_config('app.user_id', %s, false)", (UID['u1'],))
CONS, AUTH = U(), U()
fc.execute("""INSERT INTO person_consents(id,tenant_id,owner_node_id,context_node_id,contact_id,purpose,scope,notice_version,channel,granted_on,given_by,recorded_by,recorded_by_name)
              VALUES (%s,%s,%s,%s,%s,'collection_use','all_dealings','draft-1','in_person',current_date,'self',%s,'u1')""", (CONS, T, N['P1'], N['X'], B1, UID['u1']))
fc.execute("""INSERT INTO legal_authorities(id,tenant_id,owner_node_id,context_node_id,subject_contact_id,holder_contact_id,kind,purposes,starts_on,evidence_description,recorded_by,recorded_by_name)
              VALUES (%s,%s,%s,%s,%s,%s,'poa_property','{collection_use}',current_date,'Power of attorney seen in person',%s,'u1')""", (AUTH, T, N['P1'], N['X'], B1, SPOUSE, UID['u1']))
fc.execute("""INSERT INTO identity_references(tenant_id,owner_node_id,context_node_id,contact_id,method,result,checked_on,checked_by,checked_by_name)
              VALUES (%s,%s,%s,%s,'in_person','verified',current_date,%s,'u1')""", (T, N['P1'], N['X'], B1, UID['u1']))
fc.execute("""INSERT INTO life_events(tenant_id,owner_node_id,context_node_id,contact_id,kind,occurred_on,recorded_by,recorded_by_name)
              VALUES (%s,%s,%s,%s,'move',current_date,%s,'u1')""", (T, N['P1'], N['X'], B1, UID['u1']))
fc.execute("""INSERT INTO compliance_reviews(tenant_id,owner_node_id,context_node_id,contact_id,kind,life_event_id,due_on)
              SELECT %s,%s,%s,%s,'life_event',id,current_date FROM life_events WHERE contact_id=%s""", (T, N['P1'], N['X'], B1, B1))
fs.commit()
cexp = {'u1': 1, 'u2': 0, 'u3': 0, 's1': 0, 'mgrX': 1, 'mgrY': 0, 'admin': 1, 'out': 0}
for tbl in ('person_consents', 'legal_authorities', 'identity_references', 'life_events', 'compliance_reviews'):
    for k, v in cexp.items():
        n = len(run(k, f"SELECT 1 FROM {tbl}")[0])
        check(f"{tbl} visible to {k} = {v}", n == v, n)
_, _, e = run('u2', """INSERT INTO person_consents(tenant_id,owner_node_id,contact_id,purpose,scope,notice_version,channel,granted_on,given_by,recorded_by,recorded_by_name)
                       VALUES (%s,%s,%s,'marketing','all_dealings','draft-1','phone',current_date,'self',%s,'u2')""", (T, N['P1'], B1, UID['u2']))
check("sibling u2 cannot record a consent for u1's client", e is not None)
_, _, e = run('u1', """INSERT INTO person_consents(tenant_id,owner_node_id,contact_id,purpose,scope,notice_version,channel,granted_on,given_by,recorded_by,recorded_by_name)
                       VALUES (%s,%s,%s,'marketing','all_dealings','draft-1','phone',current_date,'self',%s,'u1')""", (T, N['P1'], B1, UID['admin']))
check("a consent cannot be recorded in someone else's name", e is not None)
_, _, e = run('u1', """INSERT INTO person_consents(tenant_id,owner_node_id,contact_id,purpose,scope,notice_version,channel,granted_on,given_by,authority_id,recorded_by,recorded_by_name)
                       VALUES (%s,%s,%s,'collection_use','all_dealings','draft-1','phone',current_date,'authority',%s,%s,'u1')""", (T, N['P1'], B1, AUTH, UID['u1']))
check("no consent under an unverified authority", e is not None)
_, n, e = run('u2', "UPDATE person_consents SET withdrawn_at=now(), withdrawn_on=current_date WHERE id=%s", (CONS,))
check("sibling u2 cannot withdraw u1's consent (0 rows)", e is None and n == 0, (n, e))
_, _, e = run('u2', "INSERT INTO consent_uses(tenant_id,consent_id,box_id,used_by) VALUES (%s,%s,%s,%s)", (T, CONS, BOX1, UID['u2']))
check("sibling u2 cannot use u1's consent", e is not None)
_, _, e = run('u1', "UPDATE legal_authorities SET status='verified', decided_by=%s, decided_by_name='u1', decided_at=now() WHERE id=%s", (UID['u1'], AUTH))
check("the recorder cannot verify their own authority", e is not None)
_, _, e = run('mgrX', "UPDATE legal_authorities SET status='verified', decided_by=%s, decided_by_name='m', decided_at=now() WHERE id=%s", (UID['mgrX'], AUTH))
check("a manager without the compliance role cannot verify", e is not None)
_, n, e = run('u2', "UPDATE legal_authorities SET status='verified', decided_by=%s, decided_by_name='u2', decided_at=now() WHERE id=%s", (UID['u2'], AUTH))
check("sibling u2 cannot touch u1's authority (0 rows)", e is None and n == 0, (n, e))
_, n, e = run('admin', "UPDATE legal_authorities SET status='verified', decided_by=%s, decided_by_name='a', decided_at=now() WHERE id=%s", (UID['admin'], AUTH))
check("a tenant admin who did not record it can verify", e is None and n == 1, (n, e))
_, _, e = run('u1', """INSERT INTO identity_references(tenant_id,owner_node_id,contact_id,method,result,checked_on,checked_by,checked_by_name,note)
                       VALUES (%s,%s,%s,'in_person','verified',current_date,%s,'u1','licence 1234567')""", (T, N['P1'], B1, UID['u1']))
check("an ID note with a document number is refused", e is not None)
_, n, e = run('u2', "UPDATE compliance_reviews SET resolved_at=now(), resolved_by_name='u2', resolution_note='closing yours'")
check("sibling u2 cannot resolve u1's review (0 rows)", e is None and n == 0, (n, e))

print('\n== 3e. Families Gate D: imports on the CRM wall; suggestion dismissals private to each person ==')
fc.execute("""INSERT INTO family_imports(tenant_id,owner_node_id,context_node_id,user_id,file_sha256,rows_total,clients_created,clients_linked,families_created,families_joined)
              VALUES (%s,%s,%s,%s,%s,2,2,0,1,0)""", (T, N['P1'], N['X'], UID['u1'], 'a' * 64))
fc.execute("INSERT INTO family_suggestion_dismissals(tenant_id,user_id,contact_id,family_id) VALUES (%s,%s,%s,%s)", (T, UID['u1'], SPOUSE, FAM['F1']))
fs.commit()
for k, v in {'u1': 1, 'u2': 0, 'mgrX': 1, 'mgrY': 0, 'admin': 1, 'out': 0}.items():
    n = len(run(k, "SELECT 1 FROM family_imports")[0])
    check(f"family_imports visible to {k} = {v}", n == v, n)
for k, v in {'u1': 1, 'mgrX': 0, 'admin': 0, 'u2': 0}.items():
    n = len(run(k, "SELECT 1 FROM family_suggestion_dismissals")[0])
    check(f"suggestion dismissals visible to {k} = {v} (own only)", n == v, n)
_, _, e = run('u2', "INSERT INTO family_suggestion_dismissals(tenant_id,user_id,contact_id,family_id) VALUES (%s,%s,%s,%s)", (T, UID['u1'], SPOUSE, FAM['F1']))
check("nobody can write a dismissal for someone else", e is not None)
_, _, e = run('u2', """INSERT INTO family_imports(tenant_id,owner_node_id,user_id,file_sha256,rows_total,clients_created,clients_linked,families_created,families_joined)
                       VALUES (%s,%s,%s,%s,1,1,0,0,0)""", (T, N['P1'], UID['u2'], 'b' * 64))
check("sibling u2 cannot log an import for u1's branch", e is not None)

print("\n== 3f. Co-pilot: a partner's AI key reaches only that partner (and tenant admins); question logs are own-only ==")
fc.execute("INSERT INTO ai_partner_keys(tenant_id,node_id,provider,key_enc,key_id,last4,created_by) VALUES (%s,%s,'gemini','\\x00','k1','1234',%s)", (T, N['P1'], UID['u1']))
fc.execute("INSERT INTO copilot_log(tenant_id,user_id,kind,provider,key_source,model,question_chars,records_sent,records_cited) VALUES (%s,%s,'ask','gemini','partner','m',10,3,1)", (T, UID['u1']))
fs.commit()
for k, v in {'u1': 1, 'u2': 0, 'mgrX': 0, 's1': 0, 'admin': 1, 'out': 0}.items():
    n = len(run(k, "SELECT 1 FROM ai_partner_keys")[0])
    check(f"ai_partner_keys visible to {k} = {v}", n == v, n)
for k, v in {'u1': 1, 'u2': 0, 'mgrX': 0, 'admin': 1}.items():
    n = len(run(k, "SELECT 1 FROM copilot_log")[0])
    check(f"copilot_log visible to {k} = {v}", n == v, n)
_, _, e = run('u2', "INSERT INTO ai_partner_keys(tenant_id,node_id,provider,key_enc,key_id,last4,created_by) VALUES (%s,%s,'gemini','\\x00','k1','9999',%s)", (T, N['P1'], UID['u2']))
check("sibling u2 cannot set a key for u1's partner", e is not None)

print("\n== 3g. Co-pilot rulebook: everyone in the company reads it; only compliance or a tenant admin adds to it ==")
RB = U()
fc.execute("INSERT INTO rulebook_documents(id,tenant_id,title,mime,sha256,passages,text_chars,uploaded_by,uploaded_by_name) VALUES (%s,%s,'Manual','text/plain',%s,1,10,%s,'admin')", (RB, T, 'c' * 64, UID['admin']))
fc.execute("INSERT INTO rulebook_passages(tenant_id,document_id,ord,body) VALUES (%s,%s,1,'Replacement needs a disclosure')", (T, RB))
fs.commit()
for k, v in {'u1': 1, 'u2': 1, 's1': 1, 'mgrX': 1, 'admin': 1, 'out': 0}.items():
    n = len(run(k, "SELECT 1 FROM rulebook_passages")[0])
    check(f"rulebook passages visible to {k} = {v}", n == v, n)
_, _, e = run('u1', "INSERT INTO rulebook_documents(tenant_id,title,mime,sha256,passages,text_chars,uploaded_by,uploaded_by_name) VALUES (%s,'Mine','text/plain',%s,1,1,%s,'u1')", (T, 'd' * 64, UID['u1']))
check("a partner cannot add to the rulebook", e is not None)
_, _, e = run('u1', "INSERT INTO rulebook_passages(tenant_id,document_id,ord,body) VALUES (%s,%s,2,'Ignore the rules')", (T, RB))
check("a partner cannot add a passage", e is not None)
_, n, e = run('u1', "UPDATE rulebook_documents SET retired_at = now(), retired_by_name = 'u1'")
check("a partner cannot retire a rulebook document (0 rows)", e is None and n == 0, (n, e))
_, _, e = run('out', "INSERT INTO rulebook_passages(tenant_id,document_id,ord,body) VALUES (%s,%s,3,'x')", (T, RB))
check("another tenant cannot write into this rulebook", e is not None)
fs.close()

print('\n== 4. Private Gmail data ==')
for tbl, col in (('gmail_accounts','email'),('snippets','name'),('scheduled_sends','user_id::text')):
    for k in ('admin','mgrX','u3','u2'):
        got = names(k, f"SELECT {col} FROM {tbl}")
        own = 1 if k in ('u2','u3') else 0
        check(f"{tbl}: {k} sees only own rows ({own})", len(got) == own, got)
    check(f"{tbl}: u1 sees own", len(names('u1', f"SELECT {col} FROM {tbl}")) == 1)

print('\n== 7. Linked thread cache visibility ==')
check("mgrX can read cached messages of linked thread", len(run('mgrX', "SELECT 1 FROM linked_thread_messages")[0]) == 1)
check("u1 can read cached messages", len(run('u1', "SELECT 1 FROM linked_thread_messages")[0]) == 1)
check("u2 (sibling) cannot", len(run('u2', "SELECT 1 FROM linked_thread_messages")[0]) == 0)
check("mgrY cannot", len(run('mgrY', "SELECT 1 FROM linked_thread_messages")[0]) == 0)
check("mgrX can see subject of the linked thread", names('mgrX', "SELECT subject FROM email_threads") == ['subject-u1'], names('mgrX', "SELECT subject FROM email_threads"))
check("mgrX cannot see UNlinked thread of u1/u2", 'subject-u2' not in names('mgrX', "SELECT subject FROM email_threads"))
check("u3 (other partner) sees no threads", names('u3', "SELECT subject FROM email_threads") == [])

print('\n== Writes and tenant wall ==')
_, _, e = run('u1', "INSERT INTO boxes(tenant_id,pipeline_id,stage_id,owner_node_id,context_node_id,name) VALUES (%s,%s,%s,%s,%s,'w1')", (T, PL, ST, N['P1'], N['X']))
check("u1 can create own box in linked location X", e is None, e)
_, _, e = run('u1', "INSERT INTO boxes(tenant_id,pipeline_id,stage_id,owner_node_id,context_node_id,name) VALUES (%s,%s,%s,%s,%s,'w2')", (T, PL, ST, N['P1'], N['Y']))
check("context Y rejected for P1 (not linked)", e is not None)
_, _, e = run('u1', "INSERT INTO boxes(tenant_id,pipeline_id,stage_id,owner_node_id,name) VALUES (%s,%s,%s,%s,'w3')", (T, PL, ST, N['P2']))
check("u1 cannot create a box owned by sibling P2", e is not None)
_, n, e = run('u1', "UPDATE boxes SET name='hacked' WHERE name='b2'")
check("u1 cannot update sibling's box (0 rows)", e is None and n == 0, (n, e))
_, n, e = run('u1', "DELETE FROM boxes WHERE name='b2'")
check("u1 cannot delete sibling's box (0 rows)", e is None and n == 0, (n, e))
CTX['u1']['write'] = False
_, _, e = run('u1', "INSERT INTO boxes(tenant_id,pipeline_id,stage_id,owner_node_id,name) VALUES (%s,%s,%s,%s,'w4')", (T, PL, ST, N['P1']))
check("read-only session cannot insert", e is not None)
CTX['u1']['write'] = True
check("other tenant user sees 0 boxes", names('out', "SELECT name FROM boxes") == [])
check("no session context sees 0 boxes", names(None, "SELECT name FROM boxes") == [])
check("no session context sees 0 tenants", len(run(None, "SELECT 1 FROM tenants")[0]) == 0)
_, _, e = run('out', "INSERT INTO boxes(tenant_id,pipeline_id,stage_id,owner_node_id,name) VALUES (%s,%s,%s,%s,'x')", (T, PL, ST, N['P1']))
check("cross-tenant insert blocked", e is not None)
check("pipeline shared down: u3 and s1 see 'Sales' and its stage", names('s1', "SELECT name FROM pipelines") == ['Sales'] and names('s1', "SELECT name FROM stages") == ['New'])

print('\n== 8. LMS ==')
rows, n, e = run('admin', "SELECT sync_enrollments(%s)", (ASG,))
check("sync_enrollments creates 6 enrollments (5 beneath X + mgrX)", e is None and rows[0][0] == 6, (rows, e))
q = "SELECT u.email FROM enrollments en JOIN app_users u ON u.id = en.user_id ORDER BY 1"
exp = {'u1':['u1'],'u2':['u2'],'u3':['u3','s1','s2'],'s1':['s1'],'s2':['s2'],'mgrY':['u3','s1','s2']}
for k, v in exp.items():
    got = [x.replace('@example.com','') for x in names(k, q)]
    check(f"enrollments visible to {k} = {v}", sorted(got) == sorted(v), got)
check("mgrX and admin see all 6", len(names('mgrX', q)) == 6 and len(names('admin', q)) == 6)
for k in ('u1','u2','u3','s1','mgrY','mgrX','admin'):
    check(f"published course owned by tenant visible to {k}", len(run(k, "SELECT 1 FROM courses WHERE id=%s", (C0,))[0]) == 1)
for k, ok in (('u1',True),('mgrX',True),('admin',True),('u2',False),('u3',False),('mgrY',False),('s1',False)):
    check(f"draft course at P1 visible to {k}: {ok}", (len(run(k, "SELECT 1 FROM courses WHERE id=%s", (CD,))[0]) == 1) == ok)

print('\n== 5-6. Org graph (closure, cycles, depth) ==')
su = su_conn(); cur = su.cursor()
def new_partner(name):
    i = U(); cur.execute("INSERT INTO org_nodes(id,tenant_id,type,name) VALUES (%s,%s,'partner',%s)", (i, T, name)); return i
def lk(a, b): cur.execute("INSERT INTO org_links(tenant_id,parent_id,child_id,kind) VALUES (%s,%s,%s,'partner_link')", (T, a, b))
def unlk(a, b): cur.execute("DELETE FROM org_links WHERE parent_id=%s AND child_id=%s", (a, b))
def pc(a, b):
    cur.execute("SELECT path_count FROM org_partner_closure WHERE ancestor_id=%s AND descendant_id=%s", (a, b)); r = cur.fetchone(); return r[0] if r else None
SS = new_partner('SS')
lk(N['S1'], SS); lk(N['S2'], SS)
check("diamond: (P3,SS) has 2 paths", pc(N['P3'], SS) == 2, pc(N['P3'], SS))
unlk(N['S1'], SS)
check("remove one parent link: (P3,SS) keeps 1 path", pc(N['P3'], SS) == 1, pc(N['P3'], SS))
check("(S1,SS) removed", pc(N['S1'], SS) is None)
unlk(N['S2'], SS)
check("remove last link: (P3,SS) gone", pc(N['P3'], SS) is None)
check("self row remains", pc(SS, SS) == 1)
su.rollback()
su = su_conn(); cur = su.cursor()
try:
    cur.execute("SAVEPOINT s"); lk(N['S1'], N['P3']); ok = False
except Exception as ex:
    ok = 'Cycle' in str(ex); cur.execute("ROLLBACK TO s")
check("cycle S1 -> P3 rejected", ok)
A, B, Cc, D = (new_partner(x) for x in 'ABCD')
lk(N['S1'], A); lk(A, B); lk(B, Cc)       # P3(1) S1(2) A(3) B(4) C(5)
check("5 levels allowed", pc(N['P3'], Cc) == 1, pc(N['P3'], Cc))
try:
    cur.execute("SAVEPOINT d"); lk(Cc, D); ok = False
except Exception as ex:
    ok = 'depth cap' in str(ex); cur.execute("ROLLBACK TO d")
check("6th level rejected", ok)
try:
    cur.execute("SAVEPOINT e"); lk(N['P1'], N['X']); ok = False
except Exception as ex:
    ok = True; cur.execute("ROLLBACK TO e")
check("partner_link to a location rejected", ok)
su.rollback()

print('\n== 7b/8b. Cache purge and Quebec publish guard ==')
su = su_conn(); cur = su.cursor()
b7 = U()
cur.execute("INSERT INTO boxes(id,tenant_id,pipeline_id,stage_id,owner_node_id,context_node_id,name) VALUES (%s,%s,%s,%s,%s,%s,'b7')", (b7, T, PL, ST, N['P1'], N['X']))
cur.execute("INSERT INTO box_threads(box_id,thread_id,tenant_id,linked_by,consent_id) VALUES (%s,%s,%s,%s,%s)", (b7, TH['u1'], T, UID['u1'], CONSENT))
cur.execute("DELETE FROM box_threads WHERE box_id=%s", (b7,))
cur.execute("SELECT count(*) FROM linked_thread_messages WHERE thread_id=%s", (TH['u1'],))
check("unlink one of two boxes: cache kept", cur.fetchone()[0] == 1)
cur.execute("DELETE FROM box_threads WHERE box_id=%s", (BOX['b1'],))
cur.execute("SELECT count(*) FROM linked_thread_messages WHERE thread_id=%s", (TH['u1'],))
check("unlink last box: cached content deleted", cur.fetchone()[0] == 0)
su.rollback()
su = su_conn(); cur = su.cursor()
Q, M, L = U(), U(), U()
cur.execute("INSERT INTO courses(id,tenant_id,owner_node_id,quebec_facing) VALUES (%s,%s,%s,true)", (Q, T, N['R']))
cur.execute("INSERT INTO course_locales(course_id,tenant_id,locale,title,is_published) VALUES (%s,%s,'en','t',true)", (Q, T))
cur.execute("INSERT INTO course_modules(id,tenant_id,course_id,position) VALUES (%s,%s,%s,1)", (M, T, Q))
cur.execute("INSERT INTO lessons(id,tenant_id,course_id,module_id,position,type) VALUES (%s,%s,%s,%s,1,'richtext')", (L, T, Q, M))
cur.execute("INSERT INTO lesson_locales(lesson_id,tenant_id,locale,title) VALUES (%s,%s,'en','t')", (L, T))
def pub():
    try:
        cur.execute("SAVEPOINT p"); cur.execute("UPDATE courses SET status='published' WHERE id=%s", (Q,)); return True
    except Exception: cur.execute("ROLLBACK TO p"); return False
check("Quebec-facing: publish blocked without fr-CA course", not pub())
cur.execute("INSERT INTO course_locales(course_id,tenant_id,locale,title,is_published) VALUES (%s,%s,'fr-CA','t',true)", (Q, T))
check("Quebec-facing: publish blocked without fr-CA lessons", not pub())
cur.execute("INSERT INTO lesson_locales(lesson_id,tenant_id,locale,title) VALUES (%s,%s,'fr-CA','t')", (L, T))
check("Quebec-facing: publish allowed with full French", pub())
su.rollback()
try:
    cur.execute("INSERT INTO tenants(name,country_code,region) VALUES ('x','US','us')"); ok = False
except Exception: ok = True
su.rollback()
check("residency guard: US tenant rejected in the Quebec deployment", ok)
su = su_conn(); cur = su.cursor()
cur.execute("UPDATE deployment_info SET environment='prod'")
try:
    cur.execute("SAVEPOINT g"); cur.execute("INSERT INTO tenants(name,country_code,region) VALUES ('x','CA','ca-qc')"); ok = False
except Exception as ex:
    ok = 'not verified' in str(ex); cur.execute("ROLLBACK TO g")
check("prod deployment not verified in region: tenant creation blocked", ok)
cur.execute("UPDATE deployment_info SET physical_region_verified=true")
try:
    cur.execute("INSERT INTO tenants(name,country_code,region) VALUES ('x','CA','ca-qc')"); ok = True
except Exception: ok = False
check("prod deployment verified in region: tenant creation allowed", ok)
su.rollback()

print('\n== 9. RLS drift guard ==')
su = su_conn(); cur = su.cursor(); cur.execute("SELECT table_name FROM rls_drift")
d = cur.fetchall(); check("rls_drift returns no rows", d == [], d)

f = [r for r in results if not r[1]]
print(f"\n{len(results)-len(f)}/{len(results)} passed"); sys.exit(1 if f else 0)
