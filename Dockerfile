FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/*

COPY index.html styles.css app.js manifest.json sw.js icon-192.png icon-512.png /usr/share/nginx/html/
COPY data/ /usr/share/nginx/html/data/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
