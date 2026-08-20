# Shared websocket-proxy settings for the Reverb locations.
proxy_http_version 1.1;
proxy_set_header Upgrade           $http_upgrade;
proxy_set_header Connection        "upgrade";
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;

# Websockets are long-lived by definition. Pusher's protocol pings every 30s,
# so anything above a couple of minutes is safe; an hour avoids reconnect
# storms on idle tabs. messaging-realtime.js loads on 15 different shells, so
# connections scale with open tabs, not with Messages usage.
proxy_read_timeout    3600s;
proxy_send_timeout    3600s;
proxy_connect_timeout 10s;

# Never buffer a stream.
proxy_buffering off;
proxy_cache     off;
