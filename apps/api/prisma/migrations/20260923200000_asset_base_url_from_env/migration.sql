-- The base of the e-mail images stopped being configuration: it is derived from WEB_ORIGIN, like
-- every other absolute URL in an e-mail. The seeded row carried the dev domain into every
-- environment, so prod and lab mailed images hosted by dev, and correcting the row by hand pointed
-- them at a site that might not carry that build's PNGs.
DELETE FROM "setting" WHERE "key" = 'asset_base_url';
