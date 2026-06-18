# Phase 2 scaffold. Binary wheels (rasterio bundles GDAL, shapely GEOS, pyproj PROJ)
# — no OSGeo base image needed (RUNBOOK_v3 §2.3). GDAL still needs a couple of
# system shared libs that python:slim omits (libexpat).
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR CPL_VSIL_CURL_USE_HEAD=NO
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .
# rasterio's bundled GDAL dlopen's libexpat at runtime; not present in python:slim.
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
