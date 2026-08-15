# Oracle Cloud Always Free deployment

This guide runs Fairway Four on one Ubuntu VM. It serves the site from the VM's public IP over HTTP, keeps the SQLite database in `./data`, and supports Socket.IO.

## 1. Create the Oracle account and VM

Create an [Oracle Cloud Free Tier account](https://www.oracle.com/cloud/free/). Oracle generally requires a phone number and credit-card verification, and Always Free compute must be created in the selected home region. [Oracle Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)

In **Compute → Instances**, create an instance with these settings:

- Image: **Ubuntu 24.04** (Always Free Eligible).
- Shape: **VM.Standard.A1.Flex** with 1 OCPU and 6 GB RAM, if capacity is available. The small AMD micro shape also works, but has much less memory.
- Networking: create/use a public subnet and assign a public IPv4 address.
- SSH: add your public key and download/save the private key if Oracle generates one.

In the instance subnet's security list (or network security group), add an ingress rule for **TCP port 80** from `0.0.0.0/0`. Keep SSH (port 22) restricted to your own IP address if possible.

## 2. Connect and install Docker

Replace `PUBLIC_IP` with the address Oracle assigns:

```bash
ssh ubuntu@PUBLIC_IP
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER
exit
```

Connect again after the group change takes effect.

## 3. Deploy the app

Push this project to a GitHub repository, then run on the VM:

```bash
git clone YOUR_GITHUB_REPOSITORY_URL fairway-four
cd fairway-four
docker compose -f docker-compose.oci.yml up -d --build
docker compose -f docker-compose.oci.yml ps
```

Open `http://PUBLIC_IP` in a browser. Check the service with:

```bash
curl http://localhost/api/health
```

## Updating the site

```bash
cd fairway-four
git pull
docker compose -f docker-compose.oci.yml up -d --build
```

The `./data` folder is outside the container, so games survive container rebuilds and restarts. Back it up occasionally:

```bash
tar -czf fairway-four-backup-$(date +%F).tgz data
```

## Add HTTPS later

The public-IP URL uses HTTP. For HTTPS, point a domain name at the VM's public IP and add a reverse proxy such as Caddy. Do not expose port 3000 directly; the Compose setup maps the app only to port 80.

## Always Free note

Oracle can reclaim an idle Always Free VM under its published idle-resource policy. A small active website usually has some network activity, but you should keep a local database backup. [Always Free resource policy](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
