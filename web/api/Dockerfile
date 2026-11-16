ARG PYTHON_BASE=python:3.12-slim-bookworm@sha256:2ed6491b93cd49272ee6de2b5a38440c3448360322c089fc23e370722d74179d
FROM ${PYTHON_BASE} AS dependencies
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /build
COPY requirements.lock ./
COPY wheelhouse/ /wheelhouse/
RUN python -c "import sys; assert sys.version_info[:2] == (3, 12), 'Python 3.12 is required'" \
    && python -m pip install --no-index --find-links=/wheelhouse --only-binary=:all: --require-hashes --no-cache-dir --target=/opt/python -r requirements.lock \
    && PYTHONPATH=/opt/python python -m pip check

FROM ${PYTHON_BASE}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/opt/python
WORKDIR /app
COPY --from=dependencies /opt/python /opt/python
RUN groupadd --gid 10001 machine \
    && useradd --uid 10001 --gid 10001 --create-home machine \
    && mkdir /app/data && chown 10001:10001 /app/data
COPY machine_api.py initialize.py run_server.py ./
COPY manager-tools/backup_sqlite.py ./manager-tools/backup_sqlite.py
USER 10001
ENV MACHINE_DATABASE=/app/data/machine.sqlite3
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/v2/api/readyz', timeout=3).close()"]
CMD ["python", "run_server.py"]
