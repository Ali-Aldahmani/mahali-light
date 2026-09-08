from app.shared.money import money, percent_change


def test_money_two_decimals():
    assert money(1.226) == 1.23
    assert money(None) == 0
    assert money("10.10") == 10.1


def test_percent_change_matches_express():
    assert percent_change(0, 0) == 0
    assert percent_change(10, 0) == 100
    assert percent_change(110, 100) == 10.0
