# Recovering a top-up after a price change

An unfinished credit order keeps its original price and credit quantity. Changing
configuration never silently reprices a customer's pending order.

Before archiving a Stripe price, finish pending orders using it. If an order was
saved but no checkout was created and its price was archived, checkout reports
that support is required. Reactivate that exact price in Stripe, then ask the
owner to retry: the existing order and idempotency key are reused. Leave that
price active until outstanding checkouts complete or expire. New orders use the
currently configured price.

Do not delete the order, change its frozen terms, or manually grant credits to
unblock checkout. A request whose response was lost may still have created a
payable session. If reactivation is unavailable, retain the order for operator
reconciliation with Stripe rather than creating a second purchase automatically.
