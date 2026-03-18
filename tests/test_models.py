from crypto_agent.models import Order, Position, Side, OrderType, OrderStatus


def test_order_to_dict():
    order = Order(id="abc", symbol="BTC/USDT", side=Side.BUY,
                  order_type=OrderType.MARKET, amount=0.1, filled_price=50000.0,
                  status=OrderStatus.FILLED)
    d = order.to_dict()
    assert d["side"] == "buy"
    assert d["type"] == "market"
    assert d["status"] == "filled"
    assert d["amount"] == 0.1


def test_position_pnl():
    pos = Position(symbol="BTC/USDT", amount=1.0, avg_entry_price=50000.0, current_price=55000.0)
    assert pos.unrealized_pnl == 5000.0
    assert pos.pnl_percent == 10.0


def test_position_pnl_loss():
    pos = Position(symbol="ETH/USDT", amount=2.0, avg_entry_price=3000.0, current_price=2700.0)
    assert pos.unrealized_pnl == -600.0


def test_position_zero_entry():
    pos = Position(symbol="X/USDT", amount=1.0, avg_entry_price=0.0)
    assert pos.pnl_percent == 0.0
