FROM nginx:alpine

# Удаляем дефолтную страницу nginx
RUN rm -rf /usr/share/nginx/html/*

# Копируем сайт
COPY index.html styles.css app.js /usr/share/nginx/html/
COPY data/ /usr/share/nginx/html/data/

# Простая конфигурация nginx — статика + кеш для JSON
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    gzip on; \
    gzip_types text/plain text/css application/javascript application/json; \
    location ~* \.(json|css|js)$ { \
        expires 1h; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
