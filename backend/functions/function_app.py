"""Azure Functions timer: one bounded scheduled scan per tick, through the same API the UI uses.

Deployed separately from the API (Flex Consumption plan). It never runs the pipeline itself — it POSTs
/api/scheduled-scan, which is a no-op 409 until AFTERCIRCULAR_ENABLE_SCHEDULED_SCAN=true on the backend, so enabling
this function cannot start spending credits on its own. App settings: BACKEND_URL, BACKEND_API_KEY (Key Vault ref).
"""

import logging
import os

import azure.functions as func
import httpx

app = func.FunctionApp()


@app.timer_trigger(schedule="0 0 3 * * *", arg_name="timer", run_on_startup=False, use_monitor=True)  # 03:00 UTC daily
def scheduled_scan(timer: func.TimerRequest) -> None:
    base = os.environ["BACKEND_URL"].rstrip("/")
    key = os.environ["BACKEND_API_KEY"]
    try:
        r = httpx.post(f"{base}/api/scheduled-scan", headers={"Authorization": f"Bearer {key}"}, timeout=600)
    except httpx.HTTPError as e:
        logging.error("scheduled scan: backend unreachable: %s", e)
        return
    if r.status_code == 409:
        logging.info("scheduled scan disabled on backend: %s", r.text[:200])
        return
    logging.info("scheduled scan: %s %s", r.status_code, r.text[:500])
