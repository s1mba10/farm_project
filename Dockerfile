FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

# Копируем все статические файлы
COPY index.html styles.css app.js manifest.json sw.js icon-192.png icon-512.png /usr/share/nginx/html/
COPY data/ /usr/share/nginx/html/data/

# Конфиг nginx с gzip и правильными content-type'ами для манифеста и SW
RUN printf '%s\n' \
  'server {' \
  '    listen 80;' \
  '    server_name _;' \
  '    root /usr/share/nginx/html;' \
  '    index index.html;' \
  '    gzip on;' \
  '    gzip_types text/plain text/css application/javascript application/json image/svg+xml;' \
  '    gzip_min_length 256;' \
  '    location = /sw.js {' \
  '        add_header Cache-Control "no-cache";' \
  '    }' \
  '    location = /manifest.json {' \
  '        add_header Cache-Control "no-cache";' \
  '    }' \
  '    location ~* \.(css|js|png|svg)$ {' \
  '        expires 1h;' \
  '    }' \
  '    location ~* \.json$ {' \
  '        expires 1h;' \
  '    }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
