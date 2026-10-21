# Пересылка к Telegram

Основной сервер (сайт, бот, база с данными покупателей) — в РФ. Если оттуда недоступен
api.telegram.org, бот ходит в Telegram через этот маленький Caddy на зарубежном сервере.

На зарубежном сервере:

    cd ~/sinitsa-bot && git pull
    ALLOW_IP=<IP основного сервера> docker compose -f relay/docker-compose.yml up -d

На основном сервере в `.env`:

    TELEGRAM_API_BASE=https://201-34-144-127.sslip.io

Пересылка не хранит данных и пускает только IP основного сервера и пути `/bot…`.
