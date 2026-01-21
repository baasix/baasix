# Kubernetes Deployment

This directory contains Kubernetes manifests for deploying Baasix to a Kubernetes cluster.

## Files

- `namespace.yaml` - Kubernetes namespace
- `configmap.yaml` - Non-sensitive configuration
- `secret.yaml` - Sensitive configuration (template)
- `deployment.yaml` - Baasix application deployment
- `service.yaml` - Kubernetes service
- `ingress.yaml` - Ingress configuration with TLS
- `hpa.yaml` - Horizontal Pod Autoscaler
- `pvc.yaml` - Persistent Volume Claims

## Prerequisites

- Kubernetes cluster (1.24+)
- kubectl configured
- Ingress controller (e.g., nginx-ingress)
- cert-manager (for TLS)
- PostgreSQL and Redis (external or in-cluster)

## Quick Start

### 1. Create Namespace

```bash
kubectl apply -f namespace.yaml
```

### 2. Configure Secrets

```bash
# Edit secret.yaml with your values (base64 encoded)
echo -n 'your-secret-key' | base64

# Apply secrets
kubectl apply -f secret.yaml
```

### 3. Create ConfigMap

```bash
kubectl apply -f configmap.yaml
```

### 4. Deploy Application

```bash
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
```

### 5. Configure Ingress (Optional)

```bash
kubectl apply -f ingress.yaml
```

### 6. Enable Auto-scaling (Optional)

```bash
kubectl apply -f hpa.yaml
```

## Deploy All at Once

```bash
kubectl apply -f .
```

## Commands

```bash
# View pods
kubectl get pods -n baasix

# View logs
kubectl logs -f deployment/baasix -n baasix

# Scale deployment
kubectl scale deployment baasix --replicas=5 -n baasix

# View service
kubectl get svc -n baasix

# Port forward for local access
kubectl port-forward svc/baasix 8056:80 -n baasix

# View HPA status
kubectl get hpa -n baasix

# Describe pod for debugging
kubectl describe pod <pod-name> -n baasix
```

## Rolling Updates

```bash
# Update image
kubectl set image deployment/baasix baasix=your-registry/baasix:v2.0.0 -n baasix

# Watch rollout status
kubectl rollout status deployment/baasix -n baasix

# Rollback if needed
kubectl rollout undo deployment/baasix -n baasix
```

## External Services

### Using External PostgreSQL

Update `secret.yaml` with your DATABASE_URL (base64 encoded):

```bash
# Encode your database URL
echo -n 'postgresql://user:password@your-postgres-host.example.com:5432/baasix?sslmode=require' | base64
```

### Using External Redis

Update `configmap.yaml`:

```yaml
CACHE_REDIS_URL: "redis://your-redis-host.example.com:6379"
```

## TLS/SSL

The ingress configuration expects TLS certificates. You can:

1. Use cert-manager for automatic certificate management
2. Create secrets manually with your certificates

```bash
kubectl create secret tls baasix-tls \
  --cert=path/to/cert.pem \
  --key=path/to/key.pem \
  -n baasix
```

## Monitoring

### Prometheus Metrics

Add Prometheus annotations to the deployment for scraping:

```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "8056"
  prometheus.io/path: "/metrics"
```

### Health Checks

The deployment includes liveness and readiness probes that query the root `/` endpoint.
