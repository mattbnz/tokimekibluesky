FROM oven/bun:1-debian

# Install git and other dev utilities
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (VS Code expects this)
# The bun image may already have a user with UID/GID 1000, so we handle that
ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=$USER_UID

RUN if getent group $USER_GID > /dev/null 2>&1; then \
        echo "Group $USER_GID already exists"; \
    else \
        groupadd --gid $USER_GID $USERNAME; \
    fi \
    && if id -u $USER_UID > /dev/null 2>&1; then \
        echo "User $USER_UID already exists, creating vscode as alias"; \
        useradd -m $USERNAME -g $USER_GID || true; \
    else \
        useradd --uid $USER_UID --gid $USER_GID -m $USERNAME; \
    fi \
    && mkdir -p /home/$USERNAME/.vscode-server /home/$USERNAME/.vscode-server-insiders \
    && chown -R $USERNAME:$USER_GID /home/$USERNAME

# Set working directory
WORKDIR /workspace

# Switch to non-root user
USER $USERNAME
