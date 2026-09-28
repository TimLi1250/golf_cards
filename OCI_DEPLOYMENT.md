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

## Chat and table cleanup

The server runs cleanup on startup and every minute. Chat messages older than one hour are deleted from both clubhouse and table chat. Chat panels refresh every minute so expired messages disappear from open browsers too. Tables that have never started a game expire 30 minutes after creation, including private tables and tables with seated players. Games that have started are exempt from that age limit. Empty tables are still removed.

To clear **all current tables, saved games, and chat messages** once, after pulling the updated code, run these commands from the `golf_cards` project directory on the VM:

```bash
docker compose -f docker-compose.oci.yml build fairway-four
docker compose -f docker-compose.oci.yml stop fairway-four
docker compose -f docker-compose.oci.yml run --rm --no-deps fairway-four npm run reset:tables-and-chat
docker compose -f docker-compose.oci.yml up -d fairway-four
```

The reset command saves a complete SQLite backup next to the database and prints its path before deleting anything. Player profiles are preserved. If the reset fails, inspect the error before proceeding. For a local non-Docker server, stop the server, run `npm run reset:tables-and-chat`, then restart it. The command honors `FAIRWAY_FOUR_DB_PATH`; otherwise it targets `./data/fairway-four.sqlite`. This reset is manual and does not run on normal startup.

## Add HTTPS later

The public-IP URL uses HTTP. For HTTPS, point a domain name at the VM's public IP and add a reverse proxy such as Caddy. Do not expose port 3000 directly; the Compose setup maps the app only to port 80.

## Always Free note

Oracle can reclaim an idle Always Free VM under its published idle-resource policy. A small active website usually has some network activity, but you should keep a local database backup. [Always Free resource policy](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
