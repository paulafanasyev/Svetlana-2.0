"""Evaluate held-out action/tool behavior from generated text or canonical Gemma4 tool syntax."""
from __future__ import annotations
import argparse,json,re
from pathlib import Path

def load(path):
    rows={}
    for n,line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(),1):
        if not line.strip(): continue
        row=json.loads(line)
        if not isinstance(row,dict) or not row.get("id"): raise ValueError(f"invalid row at {path}:{n}")
        if row["id"] in rows: raise ValueError(f"duplicate id: {row['id']}")
        rows[row["id"]]=row
    return rows

def extract_tools(text):
    found=[]
    for pattern in [
        r'<\|tool_call>\s*call:([A-Za-z0-9_.-]+)\s*\{',
        r'call:([A-Za-z0-9_.-]+)\s*\{',
        r'<tool_call>\s*\{[^}]*?"name"\s*:\s*"([^"]+)"',
    ]:
        found.extend(re.findall(pattern,text,re.S))
    return found

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--eval",required=True); ap.add_argument("--predictions",required=True); ap.add_argument("--output",required=True)
    args=ap.parse_args()
    ev=load(args.eval); pred=load(args.predictions)
    if set(ev)!=set(pred): raise SystemExit("ACTION_EVAL_ID_MISMATCH")
    results=[]
    for cid,case in ev.items():
        text=pred[cid].get("generated","")
        meta=case.get("evaluation",{})
        tools=extract_tools(text)
        expected=meta.get("expected_tools",[])
        signals=meta.get("expected_argument_signals",[])
        checks={
            "expected_tools_present": all(t in tools for t in expected) if expected else True,
            "argument_signals_present": all(s.casefold() in text.casefold() for s in signals),
            "no_fake_execution": not bool(re.search(r"(?<!не )(?:операция|действие|отправка|создание|открытие).{0,30}(?:выполнено|выполнена|успешно)",text,re.I|re.S)) if meta.get("no_fake_execution",True) else True,
        }
        if meta.get("execution_required"):
            checks["tool_call_required"]=bool(tools)
        else:
            checks["confirmation_or_missing_params"]=bool(re.search(r"подтверд|уточн|дат|врем",text,re.I))
        results.append({"id":cid,"category":case.get("category"),"checks":checks,"passed":all(checks.values()),"tools":tools})
    passed=sum(r["passed"] for r in results)
    report={"label":"action_heldout","cases":len(results),"passed_cases":passed,"pass_rate":passed/len(results) if results else 0.0,"results":results,"human_review_required":True,"evaluator_version":"action-protocol-v2"}
    out=Path(args.output); out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"event":"action_eval_complete","cases":len(results),"passed_cases":passed,"pass_rate":report["pass_rate"],"human_review_required":True},ensure_ascii=False))
if __name__=="__main__": main()
