export class Notifier {
  private telegramToken: string;
  private telegramChatId: string;

  constructor(telegramToken = "", telegramChatId = "") {
    this.telegramToken = telegramToken;
    this.telegramChatId = telegramChatId;
  }

  async send(message: string): Promise<void> {
    if (this.telegramToken && this.telegramChatId) {
      await this.sendTelegram(message);
    }
  }

  private async sendTelegram(message: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.telegramToken}/sendMessage`;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.telegramChatId,
          text: message.slice(0, 4000),
          parse_mode: "Markdown",
        }),
      });
    } catch {
      // silently ignore
    }
  }

  get enabled(): boolean {
    return Boolean(this.telegramToken && this.telegramChatId);
  }
}
