# SEBI egress relay (see proxy.py). Stdlib only; credentials come from secure environment variables, never the image.
FROM python:3.12-alpine
RUN adduser -D -u 10001 relay
COPY --chown=relay proxy.py /app/proxy.py
USER relay
EXPOSE 3128
CMD ["python", "-u", "/app/proxy.py"]
