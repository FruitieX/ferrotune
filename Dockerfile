# Ferrotune Music Server
# 
# Build:
#   docker build -t ferrotune .
#
# Run:
#   docker run -d \
#     --name ferrotune \
#     -p 4040:4040 \
#     -v /path/to/music:/music:ro \
#     -v ferrotune-data:/data \
#     -e FERROTUNE_DATA_DIR=/data \
#     -e FERROTUNE_HOST=0.0.0.0 \
#     ferrotune

FROM gcr.io/distroless/static@sha256:448810357cc8e67b7208988abdba0f5ec3d3aebee0a5b13eb624979792cffc0f

# Copy the compiled binary
COPY target/x86_64-unknown-linux-musl/release/ferrotune /usr/local/bin/ferrotune

# Environment variables for container operation
# FERROTUNE_DATA_DIR: Where to store database and cache (should be mounted volume)
# FERROTUNE_HOST: Bind to all interfaces by default in containers
ENV FERROTUNE_DATA_DIR=/data
ENV FERROTUNE_HOST=0.0.0.0
ENV FERROTUNE_PORT=4040

WORKDIR /app

# Expose the default port
EXPOSE 4040

# Data directory should be mounted as a volume
VOLUME ["/data"]

CMD ["ferrotune", "serve"]
