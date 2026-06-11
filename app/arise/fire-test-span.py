# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "opentelemetry-sdk",
#   "opentelemetry-exporter-otlp-proto-http",
# ]
# ///
"""Fire a test OpenInference LLM span at the local Phoenix instance.

Usage: uv run fire-test-span.py [endpoint]
Default endpoint: http://localhost:6006/v1/traces
"""

import sys
import time

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor

endpoint = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:6006/v1/traces"

resource = Resource.create(
    {
        "service.name": "halo-smoke-test",
        "openinference.project.name": "halo-smoke-test",
    }
)
provider = TracerProvider(resource=resource)
provider.add_span_processor(SimpleSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
tracer = provider.get_tracer("halo.smoke")

with tracer.start_as_current_span("halo-smoke-llm-call") as span:
    span.set_attribute("openinference.span.kind", "LLM")
    span.set_attribute("input.value", "Hello from HALO smoke test")
    time.sleep(0.2)
    span.set_attribute("output.value", "Phoenix ingestion works")

provider.force_flush()
provider.shutdown()
print(f"sent 1 span to {endpoint}")
