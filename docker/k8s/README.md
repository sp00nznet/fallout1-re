# Kubernetes Deployment

Deploy the Fallout 1 multiplayer platform to Kubernetes.

## Prerequisites

- Kubernetes cluster (1.25+)
- kubectl configured
- nginx-ingress controller installed
- Container images built and pushed to registry

## Quick Deploy

```bash
# Apply all manifests
kubectl apply -k .

# Or apply individually
kubectl apply -f namespace.yaml
kubectl apply -f secrets.yaml
kubectl apply -f postgres.yaml
kubectl apply -f redis.yaml
kubectl apply -f api.yaml
kubectl apply -f web.yaml
kubectl apply -f ingress.yaml
```

## Configuration

### 1. Update Secrets

Edit `secrets.yaml` with secure values:

```bash
# Generate secrets
openssl rand -base64 48  # For jwt-secret
openssl rand -base64 48  # For jwt-refresh-secret
openssl rand -base64 32  # For postgres-password
```

### 2. Update Ingress

Edit `ingress.yaml`:
- Replace `fallout1.yourdomain.com` with your domain
- Uncomment TLS section for HTTPS
- Configure cert-manager annotations if using Let's Encrypt

### 3. Build and Push Images

```bash
# Build images
docker build -t your-registry/fallout1-api:latest -f ../Dockerfile.api ../..
docker build -t your-registry/fallout1-web:latest -f ../Dockerfile ../..

# Push to registry
docker push your-registry/fallout1-api:latest
docker push your-registry/fallout1-web:latest
```

### 4. Update Image References

Edit `kustomization.yaml`:

```yaml
images:
  - name: fallout1-api
    newName: your-registry/fallout1-api
    newTag: latest
  - name: fallout1-web
    newName: your-registry/fallout1-web
    newTag: latest
```

## Verify Deployment

```bash
# Check pods
kubectl get pods -n fallout1

# Check services
kubectl get svc -n fallout1

# Check ingress
kubectl get ingress -n fallout1

# View logs
kubectl logs -n fallout1 -l app=fallout1-api -f
```

## Scaling

```bash
# Scale API replicas
kubectl scale deployment fallout1-api -n fallout1 --replicas=5

# Scale web replicas
kubectl scale deployment fallout1-web -n fallout1 --replicas=3
```

## Cleanup

```bash
kubectl delete -k .
```
