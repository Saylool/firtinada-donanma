#!/bin/zsh
# polls tools/job.json; runs it through the headless-Chrome harness (needed because the agent sandbox cannot start Chrome)
cd "$(dirname "$0")/.."
while true; do
  if [ -f tools/job.json ]; then
    mv tools/job.json tools/job.run
    rm -f shots/done.txt
    node tools/shot.mjs tools/job.run > shots/log.txt 2>&1
    echo finished > shots/done.txt
  fi
  sleep 1
done
