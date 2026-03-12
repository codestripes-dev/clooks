FROM ubuntu:latest
LABEL authors="joedegler"

ENTRYPOINT ["top", "-b"]
