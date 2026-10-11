# Build the test image first:
# docker build -f containers/worker/Dockerfile -t behavior-worker:security-check .
$ErrorActionPreference = 'Stop'
$taskSuffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
$taskNetwork = "behavior-security-$taskSuffix"
$taskProxy = "behavior-egress-$taskSuffix"
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskTests = Join-Path $taskRoot 'worker/test'
$taskSeccomp = Join-Path $taskRoot 'containers/worker/seccomp_profile.json'
$taskExit = 1
try {
    docker network create --internal $taskNetwork
    if ($LASTEXITCODE -ne 0) { throw 'Network creation failed' }
    docker run --detach --name $taskProxy --network bridge --init --read-only --cap-drop ALL --security-opt no-new-privileges --cpus 0.5 --memory 128m --pids-limit 64 behavior-worker:security-check node egress-proxy.ts
    if ($LASTEXITCODE -ne 0) { throw 'Proxy startup failed' }
    docker network connect $taskNetwork $taskProxy
    if ($LASTEXITCODE -ne 0) { throw 'Network connection failed' }
    docker run --rm --network $taskNetwork --init --read-only --cap-drop ALL --security-opt no-new-privileges --security-opt "seccomp=$taskSeccomp" --tmpfs /tmp:rw,nosuid,nodev,size=512m --tmpfs /home/worker/.cache:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700,size=256m --tmpfs /home/worker/.config:rw,nosuid,nodev,uid=10001,gid=10001,mode=0700,size=32m --cpus 4 --memory 2g --pids-limit 512 --shm-size 512m --env "WORKER_PROXY_URL=http://${taskProxy}:3128" --env WORKER_INITIAL_URL=https://example.com --mount "type=bind,source=$taskTests,target=/app/worker/test,readonly" behavior-worker:security-check node test/container-security-probe.mjs
    $taskExit = $LASTEXITCODE
    if ($taskExit -ne 0) { docker logs $taskProxy }
} finally {
    docker rm --force $taskProxy
    docker network rm $taskNetwork
}
exit $taskExit
