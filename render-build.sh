#!/usr/bin/env bash
set -e

mkdir -p bin

# Download static ffmpeg for Linux x64 (no apt-get needed)
curl -L -o /tmp/ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
tar -xf /tmp/ffmpeg.tar.xz -C /tmp

# Copy ffmpeg binary into your project
cp /tmp/ffmpeg-*-amd64-static/ffmpeg ./bin/ffmpeg
chmod +x ./bin/ffmpeg

# Install Node deps
npm install