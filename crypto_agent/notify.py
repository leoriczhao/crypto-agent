import aiohttp


class Notifier:
    def __init__(self, telegram_token: str = "", telegram_chat_id: str = ""):
        self.telegram_token = telegram_token
        self.telegram_chat_id = telegram_chat_id

    async def send(self, message: str):
        if self.telegram_token and self.telegram_chat_id:
            await self._send_telegram(message)

    async def _send_telegram(self, message: str):
        url = f"https://api.telegram.org/bot{self.telegram_token}/sendMessage"
        try:
            async with aiohttp.ClientSession() as session:
                await session.post(url, json={
                    "chat_id": self.telegram_chat_id,
                    "text": message[:4000],
                    "parse_mode": "Markdown",
                })
        except Exception:
            pass

    @property
    def enabled(self) -> bool:
        return bool(self.telegram_token and self.telegram_chat_id)
