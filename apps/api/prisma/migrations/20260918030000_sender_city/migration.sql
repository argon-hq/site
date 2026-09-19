-- Sender postal city is Panambi. Only touches the seeded placeholder, never an operator's edit.
UPDATE "setting"
SET "value" = jsonb_set("value", '{postalAddress}', '"Panambi, RS, Brasil"')
WHERE "key" = 'sender' AND "value"->>'postalAddress' = 'Passo Fundo, RS, Brasil';
