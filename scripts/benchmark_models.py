"""Benchmark free AI models on the real resume-tailoring task.

Each model gets exactly the prompt the app sends (/api/file/tailor) for your resume file and a job
post. The answer is graded with the app's own checks, so "applied" means the rewrite really fits
the same lines, keeps every number and adds no new ones.

Usage (keys are read from .env: GROQ_API_KEY, OPENROUTER_API_KEY, NVIDIA_API_KEY, GEMINI_API_KEY):
    python scripts/benchmark_models.py --file my_resume.pdf
    python scripts/benchmark_models.py --file my_resume.pdf --runs 2 --only groq
    python scripts/benchmark_models.py --file cv.docx --models "groq:qwen/qwen3.8-27b,nvidia:z-ai/glm-5.3-flash"
"""

import argparse
import json
import re
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import fileedit, prompts  # noqa: E402
from backend.ai.router import parse_json_text  # noqa: E402
from backend.schemas import FileTailorOutput, TailorOptions  # noqa: E402

CANDIDATES = [
    # Groq (fast hardware, free tier)
    "groq:openai/gpt-oss-120b",
    "groq:openai/gpt-oss-20b",
    "groq:qwen/qwen3.8-27b",
    # OpenRouter free models (general text models only)
    "openrouter:nvidia/nemotron-3-super-120b-a12b:free",
    "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free",
    "openrouter:nvidia/nemotron-3.5-lightning:free",
    "openrouter:google/gemma-4-31b-it:free",
    "openrouter:google/gemma-4-26b-a4b-it:free",
    "openrouter:thinkingmachines/inkling:free",
    "openrouter:thinkingmachines/inkling-small:free",
    "openrouter:dots-studio/dots-3-note-preview:free",
    # NVIDIA NIM (build.nvidia.com, free credits)
    "nvidia:deepseek-ai/deepseek-v4.1-flash",
    "nvidia:moonshotai/kimi-k3",
    "nvidia:moonshotai/kimi-k2.6",
    "nvidia:z-ai/glm-5.3-flash",
    "nvidia:z-ai/glm-5.3",
    "nvidia:nvidia/nemotron-3-super-120b-a12b",
    "nvidia:nvidia/nemotron-3.5-lightning-30b-a3b",
    "nvidia:nvidia/nemotron-3-ultra-550b-a55b",
    "nvidia:google/gemma-4-31b-it",
    "nvidia:mistralai/mistral-large-2-instruct",
    "nvidia:stepfun-ai/step-5-preview",
    "nvidia:openai/gpt-oss-20b",
    # Gemini API (free tier)
    "gemini:gemini-3.8-flash",
    "gemini:gemini-3.7-flash",
    "gemini:gemini-3.6-flash",
    "gemini:gemini-3.5-flash",
    "gemini:gemini-3.5-flash-lite",
    "gemini:gemini-3.1-flash-lite",
    "gemini:gemini-2.5-flash",
    "gemini:gemini-2.5-flash-lite",
    "gemini:gemma-4-31b-it",
]

DEFAULT_JD = """Machine Learning Engineer, Computer Vision - MedScan AI (Bengaluru, hybrid)

We build AI tools that help radiologists read CT and MRI scans faster. You will train and ship deep
learning models for medical image segmentation and put them into production.

What you'll do
- Train and evaluate segmentation models (U-Net, nnU-Net) on CT and MRI data
- Build reliable data and training pipelines in Python and PyTorch
- Deploy models as APIs with FastAPI and Docker; monitor accuracy and speed in production
- Work with clinicians to turn their feedback into model and product improvements

Requirements
- Strong Python and PyTorch
- Experience with medical imaging or computer vision (segmentation, detection)
- Experience deploying ML models (FastAPI, Docker, REST APIs, CI/CD)
- Good understanding of evaluation metrics like Dice and IoU

Nice to have
- MONAI, SimpleITK, 3D imaging
- LLMs or RAG for clinical reports
- Published research or open-source contributions
"""

BUZZWORDS = re.compile(
    r"\b(leverag\w*|spearhead\w*|orchestrat\w*|architected|synerg\w*|cutting-edge|state-of-the-art|robust|seamless\w*|"
    r"utiliz\w*|facilitat\w*|passionate|innovative|results-driven|holistic|paradigm|empower\w*|streamlin\w*|"
    r"revolutioniz\w*|meticulous\w*|adept|proficient)\b",
    re.I,
)
SPELLED_SYMBOLS = re.compile(r"\b\d+\s+(plus|percent)\b|\bnumber\s+\d+", re.I)


@dataclass
class Run:
    model: str
    ok: bool = False
    error: str = ""
    seconds: float = 0.0
    edits: int = 0
    applied: int = 0
    too_long: int = 0
    too_short: int = 0
    changed_facts: int = 0
    unchanged: int = 0
    buzzwords: int = 0
    spelled_symbols: int = 0
    out_tokens: int = 0
    limits: dict = field(default_factory=dict)


# ---------------------------------------------------------------- calling the models


def call_openai_compatible(
    url: str, key: str, model: str, system: str, prompt: str, timeout: float, extra_headers=None
):
    """Groq and OpenRouter speak the same chat-completions API."""
    base = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 4096,
    }
    tries = []
    reasoning = {}
    if "openrouter" in url:
        reasoning = {"reasoning": {"effort": "low", "exclude": True}}
    elif model.startswith("openai/gpt-oss"):
        reasoning = {"reasoning_effort": "low", "include_reasoning": False}
    elif model.startswith("qwen/"):
        reasoning = {"reasoning_effort": "none"}
    # Most structured first; drop options the model rejects.
    tries.append({**base, **reasoning, "response_format": {"type": "json_object"}})
    tries.append({**base, **reasoning})
    tries.append(base)
    headers = {"Authorization": f"Bearer {key}", **(extra_headers or {})}
    last = None
    for body in tries:
        res = httpx.post(url, json=body, headers=headers, timeout=timeout)
        last = res
        if res.status_code == 400 and any(
            k in res.text.lower() for k in ("response_format", "reasoning", "json", "unsupported")
        ):
            continue
        break
    res = last
    limits = {k: v for k, v in res.headers.items() if "ratelimit" in k.lower()}
    if res.status_code != 200:
        raise RuntimeError(f"HTTP {res.status_code}: {res.text[:200]}", limits)
    data = res.json()
    if "error" in data:
        raise RuntimeError(f"error: {str(data['error'])[:200]}", limits)
    text = data["choices"][0]["message"].get("content") or ""
    tokens = (data.get("usage") or {}).get("completion_tokens", 0)
    return text, tokens, limits


def call_gemini(key: str, model: str, system: str, prompt: str, timeout: float):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    if model.startswith("gemma"):
        # Gemma on the Gemini API takes no system instruction and no JSON mode.
        body = {
            "contents": [{"role": "user", "parts": [{"text": system + "\n\n" + prompt}]}],
            "generationConfig": {"temperature": 0.3},
        }
    else:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.3,
                "responseMimeType": "application/json",
                "responseJsonSchema": FileTailorOutput.model_json_schema(),
            },
        }
    res = httpx.post(url, json=body, headers={"x-goog-api-key": key}, timeout=timeout)
    if res.status_code != 200:
        raise RuntimeError(f"HTTP {res.status_code}: {res.text[:200]}", {})
    data = res.json()
    parts = data["candidates"][0]["content"]["parts"]
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    return text, (data.get("usageMetadata") or {}).get("candidatesTokenCount", 0), {}


def ask(spec: str, env: dict, system: str, prompt: str, timeout: float):
    provider, model = spec.split(":", 1)
    if provider == "groq":
        return call_openai_compatible(
            "https://api.groq.com/openai/v1/chat/completions", env["GROQ_API_KEY"], model, system, prompt, timeout
        )
    if provider == "openrouter":
        return call_openai_compatible(
            "https://openrouter.ai/api/v1/chat/completions",
            env["OPENROUTER_API_KEY"],
            model,
            system,
            prompt,
            timeout,
            {"HTTP-Referer": "https://tailor-dun-nu.vercel.app", "X-Title": "Tailor benchmark"},
        )
    if provider == "nvidia":
        return call_openai_compatible(
            "https://integrate.api.nvidia.com/v1/chat/completions",
            env["NVIDIA_API_KEY"],
            model,
            system,
            prompt,
            timeout,
        )
    if provider == "gemini":
        return call_gemini(env[env.get("_GEMINI_KEY_VAR", "GEMINI_API_KEY")], model, system, prompt, timeout)
    raise ValueError(f"unknown provider {provider}")


# ---------------------------------------------------------------- grading


def grade(spec: str, file_type: str, data: bytes, segments: set[str], env, system, prompt, timeout) -> Run:
    run = Run(model=spec)
    started = time.monotonic()
    try:
        text, tokens, limits = ask(spec, env, system, prompt, timeout)
        run.limits = limits
        run.out_tokens = tokens or 0
    except Exception as exc:  # network error, HTTP error, timeout
        run.seconds = round(time.monotonic() - started, 1)
        run.error = str(exc.args[0] if exc.args else exc)[:160]
        if len(exc.args) > 1 and isinstance(exc.args[1], dict):
            run.limits = exc.args[1]
        return run
    run.seconds = round(time.monotonic() - started, 1)
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()  # reasoning models think out loud
    try:
        out = FileTailorOutput.model_validate(parse_json_text(text))
    except Exception as exc:
        run.error = f"bad JSON: {str(exc)[:120]}"
        return run
    edits = {e.id: e.text for e in out.edits if e.id in segments}
    run.edits = len(edits)
    _, results = fileedit.apply(file_type, data, edits)
    for r in results:
        if hasattr(run, r.status):
            setattr(run, r.status, getattr(run, r.status) + 1)
        if r.status == "applied":
            run.buzzwords += len(BUZZWORDS.findall(r.new))
            run.spelled_symbols += len(SPELLED_SYMBOLS.findall(r.new))
    run.ok = True
    return run


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--file", required=True, help="your resume (.pdf or .docx)")
    ap.add_argument("--jd", help="text file with a job post (default: a built-in ML engineer job)")
    ap.add_argument("--runs", type=int, default=1, help="runs per model (default 1)")
    ap.add_argument("--only", help="only these providers, comma separated (groq,openrouter,gemini)")
    ap.add_argument("--models", help="comma separated provider:model list instead of the defaults")
    ap.add_argument("--timeout", type=float, default=60)
    ap.add_argument("--gemini-key", default="GEMINI_API_KEY", help="name of the .env variable holding the Gemini key")
    ap.add_argument("--out", default=str(ROOT / "scripts" / "benchmark_results.json"))
    args = ap.parse_args()

    env = {**dotenv_values(ROOT / ".env"), "_GEMINI_KEY_VAR": args.gemini_key}
    path = Path(args.file)
    data = path.read_bytes()
    file_type = fileedit.file_type_of(path.name, data)
    if not file_type:
        sys.exit("Use a .pdf or .docx file.")
    extracted = fileedit.extract(file_type, data).to_dict()
    jd = Path(args.jd).read_text(encoding="utf-8") if args.jd else DEFAULT_JD
    system = prompts.file_tailor_system(TailorOptions()) + prompts.json_instructions(
        FileTailorOutput.model_json_schema()
    )
    prompt = prompts.file_tailor_prompt(extracted, jd)
    segments = {s["id"] for s in extracted["segments"]}
    print(f"{path.name}: {len(segments)} editable lines, prompt {len(system) + len(prompt)} chars\n")

    specs = [s.strip() for s in args.models.split(",")] if args.models else CANDIDATES
    if args.only:
        wanted = {p.strip() for p in args.only.split(",")}
        specs = [s for s in specs if s.split(":", 1)[0] in wanted]
    needed = {
        "groq": "GROQ_API_KEY",
        "openrouter": "OPENROUTER_API_KEY",
        "nvidia": "NVIDIA_API_KEY",
        "gemini": args.gemini_key,
    }
    specs = [s for s in specs if env.get(needed[s.split(":", 1)[0]])]

    def one_model(spec: str) -> list[Run]:
        out = []
        for i in range(args.runs):
            r = grade(spec, file_type, data, segments, env, system, prompt, args.timeout)
            out.append(r)
            status = (
                f"{r.applied}/{len(segments)} applied ({r.too_long} long, {r.too_short} short, "
                f"{r.changed_facts} facts) buzz={r.buzzwords}"
                if r.ok
                else f"FAILED: {r.error[:90]}"
            )
            print(f"{spec:58} run {i + 1}: {r.seconds:6.1f}s  {status}", flush=True)
        return out

    # Every model runs at the same time (runs of one model stay one after another).
    with ThreadPoolExecutor(max_workers=len(specs) or 1) as pool:
        runs: list[Run] = [r for batch in pool.map(one_model, specs) for r in batch]

    # Summary: reliability first, then how many lines survived the checks, then speed.
    print("\n" + "=" * 110)
    print(f"{'model':58} {'ok':>5} {'applied%':>9} {'median s':>9} {'buzz':>5} {'facts':>6}  rate limits")
    rows = []
    for spec in specs:
        rs = [r for r in runs if r.model == spec]
        good = [r for r in rs if r.ok]
        ok_rate = len(good) / len(rs) if rs else 0
        applied = statistics.mean(r.applied / max(len(segments), 1) for r in good) if good else 0
        secs = statistics.median(r.seconds for r in good) if good else float("inf")
        buzz = sum(r.buzzwords for r in good)
        facts = sum(r.changed_facts for r in good)
        limits = next((r.limits for r in rs if r.limits), {})
        short = {k.replace("x-ratelimit-", ""): v for k, v in limits.items() if "limit" in k and "reset" not in k}
        score = ok_rate * 100 + applied * 50 - min(secs, 120) / 6 - buzz
        rows.append((score, spec, ok_rate, applied, secs, buzz, facts, short))
    for _score, spec, ok_rate, applied, secs, buzz, facts, short in sorted(rows, reverse=True):
        print(f"{spec:58} {ok_rate:5.0%} {applied:9.0%} {secs:9.1f} {buzz:5d} {facts:6d}  {short}")
    Path(args.out).write_text(json.dumps([asdict(r) for r in runs], indent=2), encoding="utf-8")
    print(f"\nDetails saved to {args.out}")


if __name__ == "__main__":
    main()
