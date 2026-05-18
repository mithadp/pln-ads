# Hugging Face Spaces uses Docker SDK — this file is the build spec.
# Python 3.11 is the cleanest target: scikit-learn / statsmodels / pandas
# all have stable wheels, no compiler needed.
FROM python:3.11-slim

# HF Spaces wants port 7860 by default; FastAPI will bind to it.
ENV PORT=7860 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install build essentials only for the wheels that lack pure-Python builds.
# scipy/numpy already ship manylinux wheels for py3.11; skip apt unless needed.
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy source + model bundles (.pkl files in repo).
COPY . .

# HF Spaces gates traffic via 7860 — uvicorn must bind there.
EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
