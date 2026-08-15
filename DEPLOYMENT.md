# Deployment

Fairway Four runs as one Node process with Socket.IO and a SQLite database.
Use a host with a persistent disk; serverless platforms with ephemeral filesystems are not suitable for this configuration.

## Recommended: Render

This repository includes `render.yaml`, which creates one Docker web service with:

- WebSocket support through the custom Socket.IO server.
- A one-instance deployment.
- A 1 GB persistent disk mounted at `/data`.
- The SQLite file at `/data/fairway-four.sqlite`.
- Health monitoring at `/api/health`.

To deploy, push this project to a GitHub repository, then in Render choose **New → Blueprint**, connect the repository, and create the resources from the detected Blueprint. Render will give the service an `onrender.com` URL; add a custom domain later from the service settings if desired.

Render web services accept public WebSocket connections, while the disk preserves the SQLite database across deploys and restarts. The disk is intentionally single-instance, which matches this app's current real-time architecture. [Render WebSockets documentation](https://render.com/docs/websocket), [Render persistent disk documentation](https://render.com/docs/disks)

## Docker

Build and run with a named volume:

```bash
docker build -t fairway-four .
docker run --rm -p 3000:3000 -v fairway-four-data:/data fairway-four
```

The container health endpoint is available at `/api/health`. The SQLite file lives in `/data/fairway-four.sqlite`.

## Environment

Set `FAIRWAY_FOUR_DB_PATH` only when using a different persistent location. Set `PORT` to change the listening port.

## Scaling note

The current real-time transport is designed for one Node instance. Horizontal scaling requires a shared database and Socket.IO adapter (such as Redis) so rooms can be coordinated across instances.
