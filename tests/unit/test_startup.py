"""Test startup wiring; real MySQL validates the TLS certificate on connection."""
import json
import os
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[2]

def run_startup(tmp_path, *, pem=None, ca_path=None, setup_exit=0):
    binpath=tmp_path/"bin"
    binpath.mkdir()
    p=binpath/"python"
    p.write_text(f'#!/bin/sh\nprintf "%s\\n" "$*" > "$STARTUP_SETUP_LOG"\nexit {setup_exit}\n')
    p.chmod(0o755)
    p=binpath/"uvicorn"
    p.write_text('''#!/usr/bin/env python3
import json,os,stat,sys
from pathlib import Path
ca=os.getenv("DB_SSL_CA")
p=Path(ca) if ca else None
r={"args":sys.argv[1:],"ca_path":ca,"ca_contents":p.read_text() if p and p.exists() else None,"ca_mode":stat.S_IMODE(p.stat().st_mode) if p and p.exists() else None}
Path(os.environ["STARTUP_RESULT"]).write_text(json.dumps(r))
''')
    p.chmod(0o755)
    env={k:v for k,v in os.environ.items() if k not in {"DB_SSL_CA","DB_SSL_CA_PEM"}}
    env.update(PATH=str(binpath)+os.pathsep+os.environ["PATH"],TMPDIR=str(tmp_path),PORT="5678",STARTUP_SETUP_LOG=str(tmp_path/"setup.log"),STARTUP_RESULT=str(tmp_path/"result.json"))
    if pem is not None:env["DB_SSL_CA_PEM"]=pem
    if ca_path is not None:env["DB_SSL_CA"]=ca_path
    proc=subprocess.run(["sh",str(ROOT/"start.sh")],env=env,cwd=ROOT,capture_output=True,text=True)
    p=tmp_path/"result.json"
    return proc,json.loads(p.read_text()) if p.exists() else None

def test_startup_keeps_mounted_ca_and_supplied_port(tmp_path):
    proc,r=run_startup(tmp_path,ca_path="/mounted/ca.pem")
    assert proc.returncode==0
    assert r["ca_path"]=="/mounted/ca.pem"
    assert r["args"]==["app.main:app","--host","0.0.0.0","--port","5678","--workers","1"]
    assert (tmp_path/"setup.log").read_text().strip()=="-m scripts.setup --seed"

def test_startup_writes_pem_env_to_private_temporary_file(tmp_path):
    pem="-----BEGIN CERTIFICATE-----\nTEST_FIXTURE_NOT_A_REAL_CA\n-----END CERTIFICATE-----"
    proc,r=run_startup(tmp_path,pem=pem,ca_path="/unused/old-ca.pem")
    assert proc.returncode==0
    assert Path(r["ca_path"]).parent==tmp_path
    assert r["ca_contents"]==pem+"\n"
    assert r["ca_mode"]==0o600

def test_startup_does_not_launch_after_bootstrap_failure(tmp_path):
    proc,r=run_startup(tmp_path,setup_exit=2)
    assert proc.returncode==2
    assert r is None
