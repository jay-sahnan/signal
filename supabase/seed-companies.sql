-- Seed companies from Apollo search results
-- Generated from Apollo mixed_companies_search results
-- File 1 (Complaints/Auto Finance): 24 unique companies
-- File 2 (QA/SaaS/Fintech): 23 unique companies
-- Cross-file duplicates (sofi.com): linked to all campaigns
-- Total unique companies: 47

BEGIN;

-- ============================================
-- Insert organizations
-- ============================================

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Exeter Finance, LLC.',
  'exeterfinance.com',
  'http://www.exeterfinance.com',
  NULL,
  'Irving, Texas',
  NULL,
  '{"apollo": {"id": "67b75f8d2e01ba000122ba51", "organization_id": "62585340be7f2f00fa2242a9", "name": "Exeter Finance, LLC.", "domain": "exeterfinance.com", "website_url": "http://www.exeterfinance.com", "linkedin_url": "http://www.linkedin.com/company/exeter-finance-corp", "facebook_url": "https://www.facebook.com/profile.php", "phone": "+1 800-321-9637", "founded_year": 2006, "publicly_traded_symbol": "XTF", "publicly_traded_exchange": "nyse", "sic_codes": ["6162"], "naics_codes": ["52239"], "organization_revenue_printed": "500M", "organization_revenue": 500000000.0, "city": "Irving", "state": "Texas", "country": "United States", "postal_code": "75039", "street_address": "222 West Las Colinas Boulevard", "num_contacts": 30, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a38a120b89ef00014c6387/picture", "alexa_ranking": 523450, "organization_headcount_six_month_growth": 0.008496176720475786, "organization_headcount_twelve_month_growth": 0.02681660899653979, "organization_headcount_twenty_four_month_growth": 0.09501845018450185, "organization_raw_address": "p.o. box 166008, irving, tx 75016, us", "owned_by_organization": {"id": "54a116d869702d3ec0bb1300", "name": "Warburg Pincus LLC", "website_url": "http://www.warburgpincus.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'HYUNDAI CAPITAL AMERICA',
  'hyundaicapitalamerica.com',
  'http://www.hyundaicapitalamerica.com',
  NULL,
  'Irvine, California',
  NULL,
  '{"apollo": {"id": "67367056e6f2710001fa2c8f", "organization_id": "5500b4b07369647a65e30800", "name": "HYUNDAI CAPITAL AMERICA", "domain": "hyundaicapitalamerica.com", "website_url": "http://www.hyundaicapitalamerica.com", "linkedin_url": "http://www.linkedin.com/company/hyundai-capital-america", "facebook_url": "https://www.facebook.com/HCACorpCulture/", "phone": "+1 949-468-4000", "founded_year": 1989, "sic_codes": ["6162"], "naics_codes": ["52222"], "organization_revenue_printed": "1B", "organization_revenue": 1000000000.0, "city": "Irvine", "state": "California", "country": "United States", "postal_code": "92612", "street_address": "3161 Michelson Drive", "num_contacts": 8, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69ae6756f686680001515ea6/picture", "organization_headcount_six_month_growth": 0.02276064610866373, "organization_headcount_twelve_month_growth": 0.08236208236208237, "organization_headcount_twenty_four_month_growth": 0.1108452950558214, "organization_raw_address": "3161 michelson drive, suite 1900, irvine, ca 92612, us", "owned_by_organization": {"id": "5dd8ea21116686008c7fb4e1", "name": "Hyundai Motor Group", "website_url": "http://www.hyundaimotorgroup.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Santander Consumer USA Holdings Inc.',
  'santanderconsumerusa.com',
  'http://www.santanderconsumerusa.com',
  NULL,
  'Dallas, Texas',
  NULL,
  '{"apollo": {"id": "6714899d8deeff0001e0c1e7", "organization_id": "559204367369641903761c00", "name": "Santander Consumer USA Holdings Inc.", "domain": "santanderconsumerusa.com", "website_url": "http://www.santanderconsumerusa.com", "linkedin_url": "http://www.linkedin.com/company/santanderconsumerusa", "facebook_url": "https://facebook.com/SantanderConsumerUSA", "phone": "+1 888-222-4227", "founded_year": 1997, "sic_codes": ["6162"], "naics_codes": ["52232"], "organization_revenue_printed": "5B", "organization_revenue": 5000000000.0, "city": "Dallas", "state": "Texas", "country": "United States", "postal_code": "75201", "street_address": "1601 Elm St", "num_contacts": 21, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/6869b269e9e3930001ff84a4/picture", "alexa_ranking": 57129, "organization_headcount_six_month_growth": -0.01062022090059473, "organization_headcount_twelve_month_growth": -0.03360995850622406, "organization_headcount_twenty_four_month_growth": -0.07137161084529506, "organization_raw_address": "1601 elm st, dallas, tx 75201, us", "owned_by_organization": {"id": "54a2449d7468692e7122bb1b", "name": "Santander", "website_url": "http://www.santander.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Global Lending Services LLC',
  'glsauto.com',
  'http://www.glsauto.com',
  NULL,
  'Greenville, South Carolina',
  NULL,
  '{"apollo": {"id": "67b75fb22e01ba000122ede5", "organization_id": "54a1394c69702d231f876200", "name": "Global Lending Services LLC", "domain": "glsllc.com", "website_url": "http://www.glsauto.com", "linkedin_url": "http://www.linkedin.com/company/global-lending-services", "phone": "+1 866-464-0269", "founded_year": 2011, "sic_codes": ["6162"], "organization_revenue_printed": "43M", "organization_revenue": 43000000.0, "city": "Greenville", "state": "South Carolina", "country": "United States", "postal_code": "29607", "street_address": "1200 Brookfield Blvd", "num_contacts": 16, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69ae04badd2a1d000120795a/picture", "organization_headcount_six_month_growth": 0.01590106007067138, "organization_headcount_twelve_month_growth": 0.05311355311355311, "organization_headcount_twenty_four_month_growth": 0.08901515151515152, "organization_raw_address": "1200 brookfield blvd, suite 300, greenville, south carolina 29607, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'United Auto Credit Corporation',
  'unitedautocredit.net',
  'http://www.unitedautocredit.net',
  NULL,
  'Newport Beach, California',
  NULL,
  '{"apollo": {"id": "6714892e5045bf00015c9a0c", "organization_id": "54a1a19074686942d39f5603", "name": "United Auto Credit Corporation", "domain": "unitedautocredit.net", "website_url": "http://www.unitedautocredit.net", "linkedin_url": "http://www.linkedin.com/company/united-auto-credit-corporation", "facebook_url": "https://www.facebook.com/UnitedAutoCredit", "phone": "+1 866-504-2133", "founded_year": 1996, "sic_codes": ["6162"], "naics_codes": ["52229"], "organization_revenue_printed": "120M", "organization_revenue": 120000000.0, "city": "Newport Beach", "state": "California", "country": "United States", "postal_code": "92660", "street_address": "1071 Camelback St", "num_contacts": 9, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/68c64c856c672c0001a38345/picture", "organization_headcount_six_month_growth": -0.01694915254237288, "organization_headcount_twelve_month_growth": -0.06148867313915857, "organization_headcount_twenty_four_month_growth": -0.1445427728613569, "organization_raw_address": "1071 camelback st, newport beach, ca 92660, us", "owned_by_organization": {"id": "5e5694818ee16e00019f5a77", "name": "Vroom", "website_url": "http://www.vroom.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Social Finance, Inc.',
  'sofi.com',
  'http://www.sofi.com',
  NULL,
  'San Francisco, California',
  NULL,
  '{"apollo": {"id": "67103a17d80b5e000107e566", "organization_id": "54a25eaa7468692e7189f71d", "name": "Social Finance, Inc.", "domain": "sofi.com", "website_url": "http://www.sofi.com", "linkedin_url": "http://www.linkedin.com/company/sofi", "facebook_url": "https://facebook.com/SoFi", "phone": "+1 855-456-7634", "founded_year": 2011, "publicly_traded_symbol": "SOFI", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6199"], "naics_codes": ["52211"], "organization_revenue_printed": "4.8B", "organization_revenue": 4769597000.0, "city": "San Francisco", "state": "California", "country": "United States", "postal_code": "94105", "street_address": "234 1st St", "num_contacts": 70, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a3dfaf0b89ef00014f29aa/picture", "alexa_ranking": 5679, "organization_headcount_six_month_growth": 0.06433998100664767, "organization_headcount_twelve_month_growth": 0.1903876792352629, "organization_headcount_twenty_four_month_growth": 0.4766139657444005, "organization_raw_address": "234 1st st, san francisco, california 94105, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'WHEELS FINANCIAL GROUP, LLC.',
  'westlakefinancial.com',
  'http://www.westlakefinancial.com',
  NULL,
  'Los Angeles, California',
  NULL,
  '{"apollo": {"id": "67b75f8d2e01ba000122b9e8", "organization_id": "54a1351669702d4b2e285c00", "name": "WHEELS FINANCIAL GROUP, LLC.", "domain": "westlakefinancial.com", "website_url": "http://www.westlakefinancial.com", "linkedin_url": "http://www.linkedin.com/company/westlake-financial", "facebook_url": "https://facebook.com/WestlakeFinancialServices", "phone": "+1 800-641-6700", "founded_year": 1988, "sic_codes": ["6163"], "naics_codes": ["52232"], "organization_revenue_printed": "370.6M", "organization_revenue": 370600000.0, "city": "Los Angeles", "state": "California", "country": "United States", "postal_code": "90010", "street_address": "4751 Wilshire Boulevard", "num_contacts": 3, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69c3b045ee8a990001018942/picture", "alexa_ranking": 119088, "organization_headcount_six_month_growth": 0.01763224181360202, "organization_headcount_twelve_month_growth": 0.06315789473684211, "organization_headcount_twenty_four_month_growth": 0.0758988015978695, "organization_raw_address": "4751 wilshire blvd., suite 100, los angeles, ca 90010, us", "owned_by_organization": {"id": "54a25ed27468693a7ea9c21d", "name": "Hankey Group", "website_url": "http://www.hankeygroup.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Lakeview Loan Servicing, LLC.',
  'lakeview.com',
  'http://www.lakeview.com',
  NULL,
  'Coral Gables, Florida',
  NULL,
  '{"apollo": {"id": "6714899c8deeff0001e0c16d", "organization_id": "5a9e965fa6da98d96d8346f5", "name": "Lakeview Loan Servicing, LLC.", "domain": "lakeview.com", "website_url": "http://www.lakeview.com", "linkedin_url": "http://www.linkedin.com/company/lakeview-loan-servicing", "phone": "+1 855-294-8564", "sic_codes": ["6162"], "naics_codes": ["52239"], "organization_revenue_printed": "283M", "organization_revenue": 283000000.0, "city": "Coral Gables", "state": "Florida", "country": "United States", "postal_code": "33146", "street_address": "4425 Ponce de Leon Blvd", "num_contacts": 21, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69aa8d2b294dd00001eaf389/picture", "alexa_ranking": 78808, "organization_headcount_six_month_growth": 0.1189189189189189, "organization_headcount_twelve_month_growth": 0.2345924453280318, "organization_headcount_twenty_four_month_growth": 0.9285714285714286, "organization_raw_address": "4425 ponce de leon blvd, coral gables, florida, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Upstart Holdings, Inc.',
  'upstart.com',
  'http://www.upstart.com',
  NULL,
  'San Mateo, California',
  NULL,
  '{"apollo": {"id": "67129a5a516fba01b0ca9865", "organization_id": "54a11b2e69702d9a8be91c00", "name": "Upstart Holdings, Inc.", "domain": "upstart.com", "website_url": "http://www.upstart.com", "linkedin_url": "http://www.linkedin.com/company/upstart-network", "facebook_url": "https://www.facebook.com/TeamUpstart", "phone": "+1 415-593-5400", "founded_year": 2012, "publicly_traded_symbol": "UPST", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6162"], "naics_codes": ["52239"], "organization_revenue_printed": "1.1B", "organization_revenue": 1075521000.0, "city": "San Mateo", "state": "California", "country": "United States", "postal_code": "94403-2577", "street_address": "2950 S Delaware St", "num_contacts": 62, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69c3ad1dee8a990001017533/picture", "alexa_ranking": 108018, "organization_headcount_six_month_growth": 0.07058047493403694, "organization_headcount_twelve_month_growth": 0.1803636363636364, "organization_headcount_twenty_four_month_growth": 0.1247401247401247, "organization_raw_address": "2950 s delaware street, ste. 410, san mateo, ca 94403, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Flagship Credit Acceptance',
  'flagshipcredit.com',
  'http://www.flagshipcredit.com',
  NULL,
  'Chadds Ford, Pennsylvania',
  NULL,
  '{"apollo": {"id": "671489ab8deeff0001e0d773", "organization_id": "55e8b9a1f3e5bb16850002e4", "name": "Flagship Credit Acceptance", "domain": "flagshipcredit.com", "website_url": "http://www.flagshipcredit.com", "linkedin_url": "http://www.linkedin.com/company/flagshipcredit", "facebook_url": "https://www.facebook.com/flagshipfinancialgroup/", "phone": "+1 800-900-5150", "founded_year": 2010, "sic_codes": ["6162"], "naics_codes": ["52239"], "organization_revenue_printed": "223.7M", "organization_revenue": 223700000.0, "city": "Chadds Ford", "state": "Pennsylvania", "country": "United States", "postal_code": "19317", "street_address": "3 Christy Drive", "num_contacts": 6, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a3d975f2d2ad000110e287/picture", "alexa_ranking": 460887, "organization_headcount_six_month_growth": -0.0968586387434555, "organization_headcount_twelve_month_growth": -0.217687074829932, "organization_headcount_twenty_four_month_growth": -0.3287937743190661, "organization_raw_address": "p.o. box 965, chadds ford, pennsylvania, united states, 19317"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Opportunity Financial, LLC',
  'oportun.com',
  'http://www.oportun.com',
  NULL,
  'San Mateo, California',
  NULL,
  '{"apollo": {"id": "699479776859df0001b2c1a5", "organization_id": "556e20ca736964110f910d01", "name": "Opportunity Financial, LLC", "domain": "oportun.com", "website_url": "http://www.oportun.com", "linkedin_url": "http://www.linkedin.com/company/oportun", "facebook_url": "https://www.facebook.com/mioportun", "phone": "+1 650-810-8823", "founded_year": 2005, "publicly_traded_symbol": "OPRT", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6199", "6411"], "organization_revenue_printed": "637.3M", "organization_revenue": 637340000.0, "city": "San Mateo", "state": "California", "country": "United States", "postal_code": "94402", "street_address": "1825 South Grant Street", "num_contacts": 2, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69ac1b239345400001ea9097/picture", "alexa_ranking": 103811, "organization_headcount_six_month_growth": 0.002090592334494774, "organization_headcount_twelve_month_growth": -0.003465003465003465, "organization_headcount_twenty_four_month_growth": 0.01338971106412967, "organization_raw_address": "1825 s grant st, san mateo, california 94402, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Atlanticus Services Corporation',
  'atlanticus.com',
  'http://www.atlanticus.com',
  NULL,
  'Atlanta, Georgia',
  NULL,
  '{"apollo": {"id": "671489ac8deeff0001e0d848", "organization_id": "54a11df669702d8ed4593901", "name": "Atlanticus Services Corporation", "domain": "atlanticus.com", "website_url": "http://www.atlanticus.com", "linkedin_url": "http://www.linkedin.com/company/atlanticus", "facebook_url": "https://facebook.com/pages/biz/financial_services-atlanta-30328/Atlanticus-Holdings-Corporation/139933173043716/", "phone": "+1 770-828-2000", "founded_year": 1996, "publicly_traded_symbol": "ATLC", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6162"], "naics_codes": ["52232"], "organization_revenue_printed": "2.0B", "organization_revenue": 1968360000.0, "city": "Atlanta", "state": "Georgia", "country": "United States", "postal_code": "30328", "street_address": "5 Concourse Parkway", "num_contacts": 15, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a45936305a510001bf1f56/picture", "organization_headcount_six_month_growth": 0.003378378378378379, "organization_headcount_twelve_month_growth": 0.1207547169811321, "organization_headcount_twenty_four_month_growth": 0.2426778242677824, "organization_raw_address": "five concourse parkway, suite 300, atlanta, ga 30328, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'First Help Financial',
  'firsthelpfinancial.com',
  'http://www.firsthelpfinancial.com',
  NULL,
  'Needham, Massachusetts',
  NULL,
  '{"apollo": {"id": "67367057e6f2710001fa2cb9", "organization_id": "54a11bc069702d94a4b35600", "name": "First Help Financial", "domain": "firsthelpfinancial.com", "website_url": "http://www.firsthelpfinancial.com", "linkedin_url": "http://www.linkedin.com/company/first-help-financial-llc-", "facebook_url": "https://facebook.com/First-Help-Financial-2275024852543252/?rf=1675216736091237", "phone": "+1 866-343-4345", "founded_year": 2006, "sic_codes": ["6162"], "naics_codes": ["52229"], "organization_revenue_printed": "275K", "organization_revenue": 275000.0, "city": "Needham", "state": "Massachusetts", "country": "United States", "postal_code": "02494-2300", "street_address": "160 Gould St", "num_contacts": 3, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69ad48168ef5e00001c05f74/picture", "organization_headcount_six_month_growth": 0.03892215568862276, "organization_headcount_twelve_month_growth": 0.1157556270096463, "organization_headcount_twenty_four_month_growth": 0.3991935483870968, "organization_raw_address": "160 gould st, suite 100, needham, massachusetts 02494, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Vervent',
  'vervent.com',
  'http://www.vervent.com',
  NULL,
  'San Diego, California',
  NULL,
  '{"apollo": {"id": "67e3ff2fc960de00010044e9", "organization_id": "5deebe38ed95990098414bdd", "name": "Vervent", "domain": "vervent.com", "website_url": "http://www.vervent.com", "linkedin_url": "http://www.linkedin.com/company/verventsd", "facebook_url": "https://facebook.com/vervent", "phone": "+1 888-486-2509", "founded_year": 2008, "organization_revenue_printed": "101.7M", "organization_revenue": 101700000.0, "city": "San Diego", "state": "California", "country": "United States", "postal_code": "92121", "street_address": "10182 Telesis Ct", "num_contacts": 11, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69aa66416e1ab300013cc9d4/picture", "organization_headcount_six_month_growth": 0.04618937644341801, "organization_headcount_twelve_month_growth": 0.08633093525179857, "organization_headcount_twenty_four_month_growth": 0.3727272727272727, "organization_raw_address": "2100 kettner blvd, suite 401, san diego, california 92101, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'American Credit Acceptance, LLC',
  'americancreditacceptance.com',
  'http://www.americancreditacceptance.com',
  NULL,
  'Spartanburg, South Carolina',
  NULL,
  '{"apollo": {"id": "675a1741c8bad40001af8ead", "organization_id": "54a1a97c7468695c82ad9305", "name": "American Credit Acceptance, LLC", "domain": "americancreditacceptance.com", "website_url": "http://www.americancreditacceptance.com", "linkedin_url": "http://www.linkedin.com/company/americancreditacceptance", "phone": "+1 855-233-3605", "founded_year": 2007, "sic_codes": ["6162"], "naics_codes": ["52231"], "organization_revenue_printed": "195.4M", "organization_revenue": 195400000.0, "city": "Spartanburg", "state": "South Carolina", "country": "United States", "postal_code": "29302", "street_address": "961 East Main Street", "num_contacts": 4, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69b295f2d9ac7d000194137a/picture", "alexa_ranking": 517827, "organization_headcount_six_month_growth": -0.01704545454545454, "organization_headcount_twelve_month_growth": 0.02064896755162242, "organization_headcount_twenty_four_month_growth": 0.02064896755162242, "organization_raw_address": "961 e main st, spartanburg, south carolina 29302, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'ENOVA INTERNATIONAL, INC.',
  'enova.com',
  'http://www.enova.com',
  NULL,
  'Chicago, Illinois',
  NULL,
  '{"apollo": {"id": "67b75fb22e01ba000122ede4", "organization_id": "54a122fd69702d9d7e4ee302", "name": "ENOVA INTERNATIONAL, INC.", "domain": "enova.com", "website_url": "http://www.enova.com", "linkedin_url": "http://www.linkedin.com/company/enova-international", "facebook_url": "https://www.facebook.com/Enova", "phone": "+1 312-568-4200", "founded_year": 2004, "publicly_traded_symbol": "ENVA", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6162"], "naics_codes": ["52239"], "organization_revenue_printed": "3.2B", "organization_revenue": 3151653000.0, "city": "Chicago", "state": "Illinois", "country": "United States", "postal_code": "60604", "street_address": "175 West Jackson Boulevard", "num_contacts": 28, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69abb20591f8f50001a8ba9c/picture", "alexa_ranking": 474610, "organization_headcount_six_month_growth": 0.0009057971014492754, "organization_headcount_twelve_month_growth": 0.01937269372693727, "organization_headcount_twenty_four_month_growth": 0.0801564027370479, "organization_raw_address": "175 w. jackson blvd, chicago, il 60604, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Pagaya',
  'pagaya.com',
  'http://www.pagaya.com',
  NULL,
  'New York, New York',
  NULL,
  '{"apollo": {"id": "671489ab8deeff0001e0d6ff", "organization_id": "5a9ce5a3a6da98d938b7ed16", "name": "Pagaya", "domain": "pagaya.com", "website_url": "http://www.pagaya.com", "linkedin_url": "http://www.linkedin.com/company/pagaya", "facebook_url": "https://facebook.com/pagayaltd/", "phone": "+1 646-710-7714", "founded_year": 2016, "publicly_traded_symbol": "PGY", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6189"], "naics_codes": ["52232"], "organization_revenue_printed": "1.3B", "organization_revenue": 1261341000.0, "city": "New York", "state": "New York", "country": "United States", "postal_code": "10016-1050", "street_address": "90 Park Ave", "num_contacts": 10, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a4bc8e647a8e0001798e28/picture", "organization_headcount_six_month_growth": 0.007532956685499058, "organization_headcount_twelve_month_growth": -0.007421150278293136, "organization_headcount_twenty_four_month_growth": -0.218978102189781, "organization_raw_address": "90 park ave, new york, 10022, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Navient Solutions, LLC.',
  'navient.com',
  'http://www.navient.com',
  NULL,
  'Herndon, Virginia',
  NULL,
  '{"apollo": {"id": "67b75f8e2e01ba000122ba99", "organization_id": "556993977369642521485e00", "name": "Navient Solutions, LLC.", "domain": "navient.com", "website_url": "http://www.navient.com", "linkedin_url": "http://www.linkedin.com/company/navient", "facebook_url": "https://facebook.com/Navient", "phone": "+1 302-283-5000", "founded_year": 2014, "publicly_traded_symbol": "NAVI", "publicly_traded_exchange": "nasdaq", "sic_codes": ["7389"], "naics_codes": ["52239"], "organization_revenue_printed": "3.2B", "organization_revenue": 3229000000.0, "city": "Herndon", "state": "Virginia", "country": "United States", "postal_code": "20171-6159", "street_address": "13865 Sunrise Valley Dr", "num_contacts": 21, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69af9c9d56a9570001fd7836/picture", "alexa_ranking": 20536, "organization_headcount_six_month_growth": -0.01515151515151515, "organization_headcount_twelve_month_growth": -0.05711695376246601, "organization_headcount_twenty_four_month_growth": -0.2227204783258595, "organization_raw_address": "13865 sunrise valley dr, herndon, virginia 20171, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'RoundPoint Mortgage Servicing LLC',
  'roundpointmortgage.com',
  'http://www.roundpointmortgage.com',
  NULL,
  'Fort Mill, South Carolina',
  NULL,
  '{"apollo": {"id": "67b75fb12e01ba000122ed98", "organization_id": "57c5080ea6da986a47e75231", "name": "RoundPoint Mortgage Servicing LLC", "domain": "roundpointmortgage.com", "website_url": "http://www.roundpointmortgage.com", "linkedin_url": "http://www.linkedin.com/company/roundpointmortgageservicing", "facebook_url": "https://facebook.com/RoundPointMortgage/", "phone": "+1 877-426-8805", "founded_year": 2007, "sic_codes": ["6162"], "naics_codes": ["52239"], "organization_revenue_printed": "260M", "organization_revenue": 260000000.0, "city": "Fort Mill", "state": "South Carolina", "country": "United States", "postal_code": "29715-0200", "street_address": "446 Wrenplace Rd", "num_contacts": 13, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69ac6de3a259920001ebea29/picture", "alexa_ranking": 297176, "organization_headcount_six_month_growth": 0.002358490566037736, "organization_headcount_twelve_month_growth": 0.02657004830917874, "organization_headcount_twenty_four_month_growth": 0.02163461538461538, "organization_raw_address": "446 wrenplace rd, fort mill, sc 29715, us", "owned_by_organization": {"id": "5592385573696419d8a1d700", "name": "Two Harbors Investment Corp.", "website_url": "http://www.twoinv.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Stellantis Financial Services US',
  'stellantis-fs.com',
  'http://www.stellantis-fs.com',
  NULL,
  'Houston, Texas',
  NULL,
  '{"apollo": {"id": "671489ac8deeff0001e0d7f6", "organization_id": "65f2c4fc0c2b9200069ddaa6", "name": "Stellantis Financial Services US", "domain": "stellantis-fs.com", "website_url": "http://www.stellantis-fs.com", "linkedin_url": "http://www.linkedin.com/company/stellantis-financial-services-us", "phone": "+1 800-439-0985", "founded_year": 1988, "sic_codes": ["6162"], "naics_codes": ["52222"], "organization_revenue": 0.0, "city": "Houston", "state": "Texas", "country": "United States", "postal_code": "77057", "street_address": "5757 Woodway Drive", "num_contacts": 8, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/66e15fb88e5970000145b1c6/picture", "organization_headcount_six_month_growth": 0.05647382920110193, "organization_headcount_twelve_month_growth": 0.1482035928143713, "organization_headcount_twenty_four_month_growth": 0.4151291512915129, "organization_raw_address": "5757 woodway dr., suite 400, houston, tx 77057, us", "owned_by_organization": {"id": "5f4895fc12d9170001a0d95a", "name": "Stellantis", "website_url": "http://www.stellantis.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'PENNYMAC LOAN SERVICES, LLC.',
  'pennymac.com',
  'http://www.pennymac.com',
  NULL,
  'Westlake Village, California',
  NULL,
  '{"apollo": {"id": "6712902408681f02d22e5a5b", "organization_id": "54a1b99274686958609e880b", "name": "PENNYMAC LOAN SERVICES, LLC.", "domain": "pennymac.com", "website_url": "http://www.pennymac.com", "linkedin_url": "http://www.linkedin.com/company/pennymac", "facebook_url": "https://facebook.com/PennymacUSA/", "phone": "+1 818-224-7442", "founded_year": 2008, "publicly_traded_symbol": "PFSI", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6162"], "naics_codes": ["52239"], "organization_revenue_printed": "3.4B", "organization_revenue": 3354261000.0, "city": "Westlake Village", "state": "California", "country": "United States", "postal_code": "91361", "street_address": "3043 Townsgate Road", "num_contacts": 38, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69b3cda5c7bb000001ae30ed/picture", "alexa_ranking": 35862, "organization_headcount_six_month_growth": 0.0430658805434504, "organization_headcount_twelve_month_growth": 0.1331105541631857, "organization_headcount_twenty_four_month_growth": 0.2648430214485545, "organization_raw_address": "3043 townsgate road, suite 200, westlake village, california 91361, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Berkadia',
  'berkadia.com',
  'http://www.berkadia.com',
  NULL,
  'New York, New York',
  NULL,
  '{"apollo": {"id": "6714892e5045bf00015c9a16", "organization_id": "54a13c8969702d231fd73302", "name": "Berkadia", "domain": "berkadia.com", "website_url": "http://www.berkadia.com", "linkedin_url": "http://www.linkedin.com/company/berkadia", "facebook_url": "https://www.facebook.com/berkadia", "phone": "+1 888-708-2727", "founded_year": 2009, "sic_codes": ["6531"], "naics_codes": ["53112"], "organization_revenue_printed": "2B", "organization_revenue": 2000000000.0, "city": "New York", "state": "New York", "country": "United States", "postal_code": "10175", "street_address": "521 5th Avenue", "num_contacts": 3, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69ae943701673c00016b503d/picture", "alexa_ranking": 595847, "organization_headcount_six_month_growth": 0.01405058209554396, "organization_headcount_twelve_month_growth": 0.01201923076923077, "organization_headcount_twenty_four_month_growth": 0.03652031185884284, "organization_raw_address": "521 fifth avenue, new york, ny 10175, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Shellpoint Partners, LLC',
  'shellpointmtg.com',
  'http://www.shellpointmtg.com',
  NULL,
  'Greenville, South Carolina',
  NULL,
  '{"apollo": {"id": "67950f6007196c0001f2fbb7", "organization_id": "54fca30d7369647f94701a00", "name": "Shellpoint Partners, LLC", "domain": "shellpointmtg.com", "website_url": "http://www.shellpointmtg.com", "linkedin_url": "http://www.linkedin.com/company/shellpoint-mortgage-servicing", "phone": "+1 800-365-7107", "founded_year": 2014, "sic_codes": ["6162"], "naics_codes": ["52239"], "organization_revenue_printed": "700M", "organization_revenue": 700000000.0, "city": "Greenville", "state": "South Carolina", "country": "United States", "postal_code": "29601-2101", "street_address": "75 Beattie Pl", "num_contacts": 3, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a38ce835b43b0001b3126a/picture", "alexa_ranking": 61137, "organization_headcount_six_month_growth": -0.02531645569620253, "organization_headcount_twelve_month_growth": -0.05714285714285714, "organization_headcount_twenty_four_month_growth": -0.04016620498614958, "organization_raw_address": "75 beattie place, suite 300, greenville, sc 29601, us", "owned_by_organization": {"id": "62f108a67cd41d00a3478ded", "name": "Rithm Capital", "website_url": "http://www.rithmcap.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Mercedes Benz Financial Services',
  'mbfs.com',
  'http://www.mbfs.com',
  NULL,
  'Fort Worth, Texas',
  NULL,
  '{"apollo": {"id": "671489ab8deeff0001e0d713", "organization_id": "54a13c7969702d2d7faa0802", "name": "Mercedes Benz Financial Services", "domain": "mbfs.com", "website_url": "http://www.mbfs.com", "linkedin_url": "http://www.linkedin.com/company/mercedes-benz-financial-services-usa-llc", "facebook_url": "https://facebook.com/mymbfs", "phone": "+1 248-991-6700", "founded_year": 1982, "naics_codes": ["52232"], "organization_revenue": 0.0, "city": "Fort Worth", "state": "Texas", "country": "United States", "postal_code": "76177-3300", "street_address": "14372 Heritage Pkwy", "num_contacts": 9, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a7e30d0369140001d1244a/picture", "alexa_ranking": 157451, "organization_headcount_six_month_growth": -0.03, "organization_headcount_twelve_month_growth": -0.05458089668615984, "organization_headcount_twenty_four_month_growth": -0.0831758034026465, "organization_raw_address": "14372 heritage pkwy, fort worth, texas 76177, us", "owned_by_organization": {"id": "6735d186c5073a0001e363b0", "name": "Mercedes-Benz AG", "website_url": "http://www.mercedes-benz.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Airwallex',
  'airwallex.com',
  'http://www.airwallex.com',
  NULL,
  'Doral, Florida',
  NULL,
  '{"apollo": {"id": "68506053fe2877001d680e42", "organization_id": "56da2bf6f3e5bb70550025be", "name": "Airwallex", "domain": "airwallex.com", "website_url": "http://www.airwallex.com", "linkedin_url": "http://www.linkedin.com/company/airwallex", "facebook_url": "https://facebook.com/airwallex", "phone": "+61 3 8620 9014", "founded_year": 2015, "sic_codes": ["6199"], "organization_revenue_printed": "1B", "organization_revenue": 1000000000.0, "city": "Doral", "state": "Florida", "country": "United States", "postal_code": "33178", "street_address": "3615 Northwest 115th Avenue", "num_contacts": 1665, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a7d61a16d94100014f066a/picture", "alexa_ranking": 17302, "organization_headcount_six_month_growth": 0.09069767441860466, "organization_headcount_twelve_month_growth": 0.2920110192837466, "organization_headcount_twenty_four_month_growth": 0.7386468952734013, "organization_raw_address": "global, global, hk"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Coinbase, Inc.',
  'coinbase.com',
  'http://www.coinbase.com',
  NULL,
  'San Francisco, California',
  NULL,
  '{"apollo": {"id": "6710d00df89bf3000140007a", "organization_id": "6258437809bcbc00c04a37a5", "name": "Coinbase, Inc.", "domain": "coinbase.com", "website_url": "http://www.coinbase.com", "linkedin_url": "http://www.linkedin.com/company/coinbase", "facebook_url": "https://facebook.com/Coinbase", "phone": "+1 302-777-0200", "founded_year": 2012, "publicly_traded_symbol": "COIN", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6211"], "naics_codes": ["5231"], "organization_revenue_printed": "7.2B", "organization_revenue": 7181325000.0, "city": "San Francisco", "state": "California", "country": "United States", "postal_code": "94111", "street_address": "100 Pine Street", "num_contacts": 129, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69c470694c87520001a9b173/picture", "alexa_ranking": 916, "organization_headcount_six_month_growth": 0.05259467040673212, "organization_headcount_twelve_month_growth": 0.1893819334389857, "organization_headcount_twenty_four_month_growth": 0.4227488151658768, "organization_raw_address": "100 pine street, san francisco, california, united states, 94111", "owned_by_organization": {"id": "5e57561a0f6c5100016742e6", "name": "Base", "website_url": "http://www.base.org"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Circle',
  'circle.com',
  'http://www.circle.com',
  NULL,
  'Cambridge, Massachusetts',
  NULL,
  '{"apollo": {"id": "6710d00df89bf3000140006b", "organization_id": "5a9ea173a6da98d94d90d99b", "name": "Circle", "domain": "circle.com", "website_url": "http://www.circle.com", "linkedin_url": "http://www.linkedin.com/company/circle-internet-financial", "facebook_url": "https://facebook.com/circle", "phone": "+1 415-992-2720", "founded_year": 2013, "publicly_traded_symbol": "CRCL", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6732"], "naics_codes": ["5231"], "organization_revenue_printed": "2.7B", "organization_revenue": 2746642000.0, "city": "Cambridge", "state": "Massachusetts", "country": "United States", "postal_code": "02140", "street_address": "2210 Massachusetts Avenue", "num_contacts": 38, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a95abf4954eb00010331a3/picture", "alexa_ranking": 77695, "organization_headcount_six_month_growth": 0.07491289198606271, "organization_headcount_twelve_month_growth": 0.1934235976789168, "organization_headcount_twenty_four_month_growth": 0.3240343347639485, "organization_raw_address": "2210 massachusetts avenue, cambridge, massachusetts, united states"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Checkout.com',
  'checkout.com',
  'http://www.checkout.com',
  NULL,
  'London, England',
  NULL,
  '{"apollo": {"id": "67f3f157a0b4e0000198e978", "organization_id": "5e56162a9d5ff70001d762b7", "name": "Checkout.com", "domain": "checkout.com", "website_url": "http://www.checkout.com", "linkedin_url": "http://www.linkedin.com/company/checkout", "facebook_url": "https://www.facebook.com/checkout/", "phone": "+44 20 7323 3888", "founded_year": 2012, "sic_codes": ["7375"], "naics_codes": ["52232"], "organization_revenue_printed": "435M", "organization_revenue": 435000000.0, "city": "London", "state": "England", "country": "United Kingdom", "postal_code": "W1U 2RP", "street_address": "32 Wigmore Street", "num_contacts": 17, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69b114f164004f0001c6fdcd/picture", "alexa_ranking": 2622, "organization_headcount_six_month_growth": 0.01397712833545108, "organization_headcount_twelve_month_growth": 0.08130081300813008, "organization_headcount_twenty_four_month_growth": 0.2258064516129032, "organization_raw_address": "32 wigmore street, city of westminster, england, united kingdom"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Neo Financial',
  'neofinancial.com',
  'http://www.neofinancial.com',
  NULL,
  'Calgary, Alberta',
  NULL,
  '{"apollo": {"id": "675a1741c8bad40001af8ec8", "organization_id": "5d830a02dbec4e00d77e99e8", "name": "Neo Financial", "domain": "neofinancial.com", "website_url": "http://www.neofinancial.com", "linkedin_url": "http://www.linkedin.com/company/neo-financial", "facebook_url": "https://www.facebook.com/neofinancial/", "phone": "+1 800-282-1376", "founded_year": 2019, "naics_codes": ["52211"], "organization_revenue_printed": "115M", "organization_revenue": 115000000.0, "city": "Calgary", "state": "Alberta", "country": "Canada", "postal_code": "T2G 0G1", "street_address": "632 Confluence Way", "num_contacts": 12, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69ad7fff64723f0001740b1c/picture", "alexa_ranking": 124698, "organization_headcount_six_month_growth": 0.08091908091908091, "organization_headcount_twelve_month_growth": 0.3997412677878396, "organization_headcount_twenty_four_month_growth": 0.1697297297297297, "organization_raw_address": "200 - 632 confluence way se, calgary, alberta, canada, t2g 0g1"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Interactive Brokers',
  'interactivebrokers.com',
  'http://www.interactivebrokers.com',
  NULL,
  'Greenwich, Connecticut',
  NULL,
  '{"apollo": {"id": "67b75fc42e01ba00012306c5", "organization_id": "5fcb22c0f5649900017e1eef", "name": "Interactive Brokers", "domain": "interactivebrokers.com", "website_url": "http://www.interactivebrokers.com", "linkedin_url": "http://www.linkedin.com/company/interactive-brokers", "facebook_url": "https://www.facebook.com/interactivebrokers", "phone": "+1 203-618-5800", "founded_year": 1977, "publicly_traded_symbol": "IBKR", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6211"], "naics_codes": ["5231"], "organization_revenue_printed": "10.2B", "organization_revenue": 10232000000.0, "city": "Greenwich", "state": "Connecticut", "country": "United States", "postal_code": "06830-5503", "street_address": "2 Pickwick Plz", "num_contacts": 30, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a472728067070001eef68b/picture", "alexa_ranking": 4005, "organization_headcount_six_month_growth": 0.01526070368800339, "organization_headcount_twelve_month_growth": 0.06302707501109632, "organization_headcount_twenty_four_month_growth": 0.1249412869891968, "organization_raw_address": "2 pickwick plaza, greenwich, connecticut 06830, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Green Dot Corporation',
  'greendot.com',
  'http://www.greendot.com',
  NULL,
  'Austin, Texas',
  NULL,
  '{"apollo": {"id": "6714899d8deeff0001e0c429", "organization_id": "5f71ba04257b0300be8cea6b", "name": "Green Dot Corporation", "domain": "greendot.com", "website_url": "http://www.greendot.com", "linkedin_url": "http://www.linkedin.com/company/green-dot-corporation", "facebook_url": "https://www.facebook.com/GreenDotBank/", "phone": "+1 626-765-2000", "founded_year": 1999, "publicly_traded_symbol": "GDOT", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6021"], "naics_codes": ["52232"], "organization_revenue_printed": "2.1B", "organization_revenue": 2080491000.0, "city": "Austin", "state": "Texas", "country": "United States", "postal_code": "78701", "street_address": "114 West 7th Street", "num_contacts": 20, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a4a050a29de10001304943/picture", "alexa_ranking": 67468, "organization_headcount_six_month_growth": 0.004703668861712135, "organization_headcount_twelve_month_growth": 0.004703668861712135, "organization_headcount_twenty_four_month_growth": 0.0658682634730539, "organization_raw_address": "1675 n. freedom blvd (200 west), provo, utah, united states, 84604", "owned_by_organization": {"id": "5b86bb81f874f760bf415967", "name": "CommerceOne Bank", "website_url": "http://www.commerceonebank.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Saxo Bank',
  'home.saxo',
  'http://www.home.saxo',
  NULL,
  'Hellerup, Capital Region of Denmark',
  NULL,
  '{"apollo": {"id": "67f3f157a0b4e0000198e8d6", "organization_id": "61bc41668558fe00c28da604", "name": "Saxo Bank", "domain": "home.saxo", "website_url": "http://www.home.saxo", "linkedin_url": "http://www.linkedin.com/company/saxo-bank", "facebook_url": "https://facebook.com/saxobank", "phone": "+45 39 77 40 00", "founded_year": 1992, "sic_codes": ["6211"], "naics_codes": ["5231"], "organization_revenue_printed": "654.2M", "organization_revenue": 654200000.0, "city": "Hellerup", "state": "Capital Region of Denmark", "country": "Denmark", "postal_code": "2900", "street_address": "15 Philip Heymans Alle", "num_contacts": 11, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a5265f409c7d0001dbcea7/picture", "alexa_ranking": 132203, "organization_headcount_six_month_growth": 0.04166666666666666, "organization_headcount_twelve_month_growth": 0.05162523900573614, "organization_headcount_twenty_four_month_growth": 0.07212475633528265, "organization_raw_address": "philip heymans alle 15, copenhagen, capital region 2900, dk", "owned_by_organization": {"id": "54a25d617468693fda4b371d", "name": "J. Safra Sarasin", "website_url": "http://www.jsafrasarasin.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Altisource Portfolio Solutions, S.à r.l.',
  'altisource.com',
  'http://www.altisource.com',
  NULL,
  'Luxembourg, District de Luxembourg',
  NULL,
  '{"apollo": {"id": "69e106a89e91c100012eb47f", "organization_id": "5f98aed5953f5200beee6f71", "name": "Altisource Portfolio Solutions, S.à r.l.", "domain": "altisource.com", "website_url": "http://www.altisource.com", "linkedin_url": "http://www.linkedin.com/company/altisource", "facebook_url": "https://www.facebook.com/Altisource/", "phone": "+352 87 78 39 7117", "founded_year": 2009, "publicly_traded_symbol": "ASPS", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6531"], "naics_codes": ["53121"], "organization_revenue_printed": "171.0M", "organization_revenue": 170975000.0, "city": "Luxembourg", "state": "District de Luxembourg", "country": "Luxembourg", "postal_code": "2163", "street_address": "40 Avenue Monterey", "num_contacts": 5, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69abb3adc908aa0001541408/picture", "alexa_ranking": 311906, "organization_headcount_six_month_growth": 0.02013942680092951, "organization_headcount_twelve_month_growth": 0.05698234349919743, "organization_headcount_twenty_four_month_growth": 0.08933002481389578, "organization_raw_address": "40, avenue monterey, l-2163 luxembourg, lu"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Co-operative Bank of Kenya',
  'co-opbank.co.ke',
  'http://www.co-opbank.co.ke',
  NULL,
  'Nairobi, Nairobi County',
  NULL,
  '{"apollo": {"id": "67f3e056e809d70001fc06d3", "organization_id": "55923999736964191224de00", "name": "Co-operative Bank of Kenya", "domain": "co-opbank.co.ke", "website_url": "http://www.co-opbank.co.ke", "linkedin_url": "http://www.linkedin.com/company/co-operative-bank-of-kenya", "facebook_url": "https://www.facebook.com/coopbankenya/", "phone": "+254 20 3276000", "founded_year": 1965, "publicly_traded_symbol": "COOP", "publicly_traded_exchange": "other", "sic_codes": ["6021"], "naics_codes": ["52211"], "organization_revenue_printed": "605.3M", "organization_revenue": 605327000.0, "city": "Nairobi", "state": "Nairobi County", "country": "Kenya", "street_address": "University Way", "num_contacts": 6, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69638faaf660080001ebd4ed/picture", "alexa_ranking": 82022, "organization_headcount_six_month_growth": 0.005163511187607574, "organization_headcount_twelve_month_growth": 0.01388888888888889, "organization_headcount_twenty_four_month_growth": 0.04800358905338717, "organization_raw_address": "p.o. box 48231, nairobi, nairobi province, kenya, 00100"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'M-KOPA',
  'm-kopa.com',
  'http://www.m-kopa.com',
  NULL,
  'London, England',
  NULL,
  '{"apollo": {"id": "67f3f145a0b4e0000198d0ff", "organization_id": "55ea57f8f3e5bb58e10043ac", "name": "M-KOPA", "domain": "m-kopa.com", "website_url": "http://www.m-kopa.com", "linkedin_url": "http://www.linkedin.com/company/m-kopa", "facebook_url": "https://www.facebook.com/mkopakenya/", "phone": "+254 707 333222", "founded_year": 2011, "sic_codes": ["7389"], "naics_codes": ["54151"], "organization_revenue_printed": "416M", "organization_revenue": 416000000.0, "city": "London", "state": "England", "country": "United Kingdom", "num_contacts": 9, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69597c3feb51f1000187cc1a/picture", "organization_headcount_six_month_growth": 0.001928020565552699, "organization_headcount_twelve_month_growth": 0.03176704169424222, "organization_headcount_twenty_four_month_growth": 0.1048901488306166, "organization_raw_address": "London, GB"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Mukuru',
  'mukuru.com',
  'http://www.mukuru.com',
  NULL,
  'Cape Town, Western Cape',
  NULL,
  '{"apollo": {"id": "67f3f156a0b4e0000198e87f", "organization_id": "55e895c2f3e5bb6b500009b2", "name": "Mukuru", "domain": "mukuru.com", "website_url": "http://www.mukuru.com", "linkedin_url": "http://www.linkedin.com/company/mukuru", "facebook_url": "https://facebook.com/mukurudotcom", "phone": "+27 860 018 555", "founded_year": 2004, "sic_codes": ["6099"], "naics_codes": ["52232"], "organization_revenue_printed": "12M", "organization_revenue": 12000000.0, "city": "Cape Town", "state": "Western Cape", "country": "South Africa", "postal_code": "7925", "street_address": "Kotzee Rd", "num_contacts": 8, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/695a2ffa7924f30001bd54a4/picture", "alexa_ranking": 559157, "organization_headcount_six_month_growth": 0.001408450704225352, "organization_headcount_twelve_month_growth": 0.01209964412811388, "organization_headcount_twenty_four_month_growth": 0.06278026905829596, "organization_raw_address": "kotzee rd, cape town, western cape, south africa, 7925"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'GCash',
  'gcash.com',
  'http://www.gcash.com',
  NULL,
  'Taguig, Kalakhang Maynila',
  NULL,
  '{"apollo": {"id": "67b75fce2e01ba00012318fc", "organization_id": "5e1e3578019803008da61fdb", "name": "GCash", "domain": "gcash.com", "website_url": "http://www.gcash.com", "linkedin_url": "http://www.linkedin.com/company/wearegcash", "facebook_url": "https://www.facebook.com/gcashofficial/", "phone": "+63 926 017 0248", "founded_year": 2015, "naics_codes": ["52232"], "organization_revenue_printed": "695M", "organization_revenue": 695000000.0, "city": "Taguig", "state": "Kalakhang Maynila", "country": "Philippines", "street_address": "30th Street", "num_contacts": 1, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69adf06ef6866800014d9560/picture", "alexa_ranking": 24024, "organization_headcount_six_month_growth": 0.02270916334661354, "organization_headcount_twelve_month_growth": 0.1328331862312445, "organization_headcount_twenty_four_month_growth": 0.3771459227467811, "organization_raw_address": "w global center, 9th ave. cor. 30th st., bonifacio global city, taguig, metro manila 1630, ph"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Modulr',
  'modulrfinance.com',
  'http://www.modulrfinance.com',
  NULL,
  'London, England',
  NULL,
  '{"apollo": {"id": "675a1741c8bad40001af8f19", "organization_id": "56dbec0ff3e5bb2f52000cfe", "name": "Modulr", "domain": "modulrfinance.com", "website_url": "http://www.modulrfinance.com", "linkedin_url": "http://www.linkedin.com/company/modulr-finance", "facebook_url": "https://facebook.com/Modulr-697978407323939/", "phone": "+44 303 313 0060", "founded_year": 2015, "sic_codes": ["6099"], "naics_codes": ["52232"], "organization_revenue_printed": "66M", "organization_revenue": 66000000.0, "city": "London", "state": "England", "country": "United Kingdom", "postal_code": "W12 7RZ", "street_address": "58 Wood Lane", "num_contacts": 11, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a496468d9cfa0001318a71/picture", "organization_headcount_six_month_growth": 0.1428571428571428, "organization_headcount_twelve_month_growth": 1.327272727272727, "organization_headcount_twenty_four_month_growth": 2.555555555555555, "organization_raw_address": "scale space, 58 wood lane, london, england w12 7rz, gb"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Sapiens',
  'sapiens.com',
  'http://www.sapiens.com',
  NULL,
  'Holon, Center District',
  NULL,
  '{"apollo": {"id": "699479776859df0001b2c20e", "organization_id": "54a1292a69702d90a2bb9c01", "name": "Sapiens", "domain": "sapiens.com", "website_url": "http://www.sapiens.com", "linkedin_url": "http://www.linkedin.com/company/sapiens", "facebook_url": "https://facebook.com/SapiensIntCorp/", "phone": "+972 3-790-2000", "founded_year": 1982, "publicly_traded_symbol": "SPNS", "publicly_traded_exchange": "nasdaq", "sic_codes": ["7375"], "naics_codes": ["54151"], "organization_revenue_printed": "542.4M", "organization_revenue": 542379000.0, "city": "Holon", "state": "Center District", "country": "Israel", "postal_code": "58000", "street_address": "26 הרוקמים", "num_contacts": 1, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69ad0da94ef6d600015f89fd/picture", "alexa_ranking": 155627, "organization_headcount_six_month_growth": -0.01649144506287363, "organization_headcount_twelve_month_growth": 0.04857142857142857, "organization_headcount_twenty_four_month_growth": 0.1033765032377428, "organization_raw_address": "26 harokmim st, azrieli center, building a, holon, israel 588 5800, il", "owned_by_organization": {"id": "54a11d7a69702d77c29a2901", "name": "Advent", "website_url": "http://www.adventinternational.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Uphold',
  'uphold.com',
  'http://www.uphold.com',
  NULL,
  'New York, New York',
  NULL,
  '{"apollo": {"id": "67367055e6f2710001fa2c3c", "organization_id": "56dea956f3e5bb707e001884", "name": "Uphold", "domain": "uphold.com", "website_url": "http://www.uphold.com", "linkedin_url": "http://www.linkedin.com/company/upholdinc", "facebook_url": "https://facebook.com/upholdinc/", "phone": "+1 415-793-7924", "founded_year": 2013, "sic_codes": ["6211"], "naics_codes": ["5231"], "organization_revenue_printed": "300M", "organization_revenue": 300000000.0, "city": "New York", "state": "New York", "country": "United States", "postal_code": "10011-4608", "street_address": "6 W 18th St", "num_contacts": 18, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69ad89acbda5430001b9c586/picture", "alexa_ranking": 28722, "organization_headcount_six_month_growth": 0.03045685279187817, "organization_headcount_twelve_month_growth": 0.1734104046242775, "organization_headcount_twenty_four_month_growth": 0.2378048780487805, "organization_raw_address": "6 w 18th street, 3rd floor, new york, new york 10011, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Idaho Housing And Finance Association',
  'bankunited.com',
  'http://www.bankunited.com',
  NULL,
  'Miami Lakes, Florida',
  NULL,
  '{"apollo": {"id": "6711503ae5754d0001580c0e", "organization_id": "5e5802c68d755a00012cb0bb", "name": "Idaho Housing And Finance Association", "domain": "bankunited.com", "website_url": "http://www.bankunited.com", "linkedin_url": "http://www.linkedin.com/company/bankunited", "facebook_url": "https://www.facebook.com/bankunited.official", "phone": "+1 305-569-2000", "founded_year": 2009, "publicly_traded_symbol": "BKU", "publicly_traded_exchange": "nasdaq", "sic_codes": ["6021"], "naics_codes": ["52211"], "organization_revenue_printed": "2.1B", "organization_revenue": 2142418000.0, "city": "Miami Lakes", "state": "Florida", "country": "United States", "postal_code": "33016", "street_address": "7815 Northwest 148th Street", "num_contacts": 18, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a6937d01fb76000124b6a7/picture", "alexa_ranking": 709920, "organization_headcount_six_month_growth": 0.01593625498007968, "organization_headcount_twelve_month_growth": 0.06060606060606061, "organization_headcount_twenty_four_month_growth": 0.1383928571428572, "organization_raw_address": "7815 nw 148th st, miami lakes, fl 33016, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Galileo Financial Technologies',
  'galileo-ft.com',
  '',
  NULL,
  'Sandy, Utah',
  NULL,
  '{"apollo": {"id": "67367056e6f2710001fa2c82", "organization_id": "54a1211369702d86b6d46c02", "name": "Galileo Financial Technologies", "domain": "galileo-ft.com", "linkedin_url": "http://www.linkedin.com/company/galileo-financial-technologies", "phone": "+1 503-555-1212", "founded_year": 2001, "organization_revenue_printed": "133.7M", "organization_revenue": 133700000.0, "city": "Sandy", "state": "Utah", "country": "United States", "postal_code": "84070-4419", "street_address": "9800 S Monroe St", "num_contacts": 4, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a818633b5eb3000142296c/picture", "organization_headcount_six_month_growth": 0.0134793597304128, "organization_headcount_twelve_month_growth": 0.04973821989528796, "organization_headcount_twenty_four_month_growth": 0.1668283220174588, "organization_raw_address": "9800 s monroe street, 7th floor, sandy, ut 84070, us", "owned_by_organization": {"id": "54a25eaa7468692e7189f71d", "name": "SoFi", "website_url": "http://www.sofi.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Evolve Bank & Trust',
  'getevolved.com',
  'http://www.getevolved.com',
  NULL,
  'Memphis, Tennessee',
  NULL,
  '{"apollo": {"id": "6711503ae5754d0001580bfc", "organization_id": "5d367126a3ae61756579f465", "name": "Evolve Bank & Trust", "domain": "getevolved.com", "website_url": "http://www.getevolved.com", "linkedin_url": "http://www.linkedin.com/company/evolve-bank-&-trust", "facebook_url": "https://facebook.com/getevolved", "phone": "+1 870-856-1078", "founded_year": 1925, "sic_codes": ["6021"], "naics_codes": ["52211"], "organization_revenue_printed": "25M", "organization_revenue": 25000000.0, "city": "Memphis", "state": "Tennessee", "country": "United States", "postal_code": "38119-0902", "street_address": "6000 Poplar Ave", "num_contacts": 8, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/696287b75e6cf600013d4577/picture", "organization_headcount_six_month_growth": 0.01525054466230937, "organization_headcount_twelve_month_growth": 0.008658008658008658, "organization_headcount_twenty_four_month_growth": -0.01479915433403805, "organization_raw_address": "6000 poplar avenue, suite 300, memphis, tennessee 38119, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'MARINER FINANCE, LLC',
  'marinerfinance.com',
  'http://www.marinerfinance.com',
  NULL,
  'Nottingham, Maryland',
  NULL,
  '{"apollo": {"id": "671489ab8deeff0001e0d715", "organization_id": "54a1396769702d24d3fa5f00", "name": "MARINER FINANCE, LLC", "domain": "marinerfinance.com", "website_url": "http://www.marinerfinance.com", "linkedin_url": "http://www.linkedin.com/company/mariner-finance", "facebook_url": "https://facebook.com/MarinerFinance", "phone": "+1 443-640-0040", "founded_year": 2002, "sic_codes": ["6162"], "naics_codes": ["52239"], "organization_revenue_printed": "100M", "organization_revenue": 100000000.0, "city": "Nottingham", "state": "Maryland", "country": "United States", "postal_code": "21236-5034", "street_address": "8110 Corporate Dr", "num_contacts": 12, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69b25bcb148c1500016c1bb9/picture", "alexa_ranking": 528871, "organization_headcount_six_month_growth": -0.009732360097323601, "organization_headcount_twelve_month_growth": 0.004938271604938272, "organization_headcount_twenty_four_month_growth": 0.08436944937833037, "organization_raw_address": "8110 corporate drive, nottingham, maryland 21236, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'NHBC',
  'nhbc.co.uk',
  'http://www.nhbc.co.uk',
  NULL,
  'Milton Keynes, England',
  NULL,
  '{"apollo": {"id": "67f3dce5003ffd0001d7f8d3", "organization_id": "559241867369644859cb9b00", "name": "NHBC", "domain": "nhbc.co.uk", "website_url": "http://www.nhbc.co.uk", "linkedin_url": "http://www.linkedin.com/company/nhbc", "facebook_url": "https://www.facebook.com/pages/NHBC/155732237782515", "phone": "+44 344 633 1000", "founded_year": 1936, "sic_codes": ["6531"], "naics_codes": ["52412"], "organization_revenue_printed": "322M", "organization_revenue": 322000000.0, "city": "Milton Keynes", "state": "England", "country": "United Kingdom", "postal_code": "MK5", "street_address": "Davy Avenue", "num_contacts": 5, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a3994b81149100015dd7d2/picture", "organization_headcount_six_month_growth": 0.0, "organization_headcount_twelve_month_growth": 0.0625, "organization_headcount_twenty_four_month_growth": -0.1052631578947368, "organization_raw_address": "davy avenue, knowlhill, milton keynes, mk5 8fp, gb"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Elavon, Inc.',
  'elavon.com',
  'http://www.elavon.com',
  NULL,
  'Atlanta, Georgia',
  NULL,
  '{"apollo": {"id": "68b9ab2293787a00010dd676", "organization_id": "54a2207674686938252a260f", "name": "Elavon, Inc.", "domain": "elavon.com", "website_url": "http://www.elavon.com", "linkedin_url": "http://www.linkedin.com/company/elavon-inc", "facebook_url": "https://facebook.com/ElavonInc/", "phone": "+1 800-725-1243", "founded_year": 1991, "publicly_traded_exchange": "nyse", "sic_codes": ["7375"], "naics_codes": ["52232"], "organization_revenue_printed": "1.8B", "organization_revenue": 1800000000.0, "city": "Atlanta", "state": "Georgia", "country": "United States", "postal_code": "30328", "street_address": "2 Concourse Parkway", "num_contacts": 3, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69a46d9ddab2560001ad8db1/picture", "alexa_ranking": 185478, "organization_headcount_six_month_growth": -0.008567348881485007, "organization_headcount_twelve_month_growth": -0.01419782300047326, "organization_headcount_twenty_four_month_growth": -0.02663551401869159, "organization_raw_address": "two concourse parkway, suite 800, atlanta, ga 30328, us", "owned_by_organization": {"id": "5d0a05c380f93e2e1b4cfc74", "name": "U.S. Bank", "website_url": "http://www.usbank.com"}}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;

INSERT INTO organizations (name, domain, url, industry, location, description, enrichment_data, enrichment_status, last_enriched_at, source)
VALUES (
  'Plymouth Rock Assurance',
  'plymouthrock.com',
  'http://www.plymouthrock.com',
  NULL,
  'Boston, Massachusetts',
  NULL,
  '{"apollo": {"id": "68b9ab2293787a00010dd642", "organization_id": "5500b2047369642de0682000", "name": "Plymouth Rock Assurance", "domain": "plymouthrock.com", "website_url": "http://www.plymouthrock.com", "linkedin_url": "http://www.linkedin.com/company/plymouth-rock-assurance", "facebook_url": "https://www.facebook.com/PlymouthRockAssurance", "phone": "+1 855-993-4470", "founded_year": 1983, "sic_codes": ["6361"], "naics_codes": ["52412"], "organization_revenue_printed": "866.7M", "organization_revenue": 866725000.0, "city": "Boston", "state": "Massachusetts", "country": "United States", "postal_code": "02111", "street_address": "695 Atlantic Avenue", "num_contacts": 2, "logo_url": "https://zenprospect-production.s3.amazonaws.com/uploads/pictures/69ad86693e0f84000102fe38/picture", "alexa_ranking": 106293, "organization_headcount_six_month_growth": 0.02370555208983157, "organization_headcount_twelve_month_growth": 0.05192307692307693, "organization_headcount_twenty_four_month_growth": 0.1403752605976372, "organization_raw_address": "695 atlantic avenue, boston, ma 02111, us"}}'::jsonb,
  'enriched',
  NOW(),
  'apollo'
)
ON CONFLICT (domain) WHERE domain IS NOT NULL DO NOTHING;


-- ============================================
-- Link to campaigns
-- ============================================

-- File 1: Auto Finance/Lending -> Complaints + Sales Compliance campaigns
INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'exeterfinance.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'exeterfinance.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'hyundaicapitalamerica.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'hyundaicapitalamerica.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'santanderconsumerusa.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'santanderconsumerusa.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'glsauto.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'glsauto.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'unitedautocredit.net'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'unitedautocredit.net'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'sofi.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'sofi.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'westlakefinancial.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'westlakefinancial.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'lakeview.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'lakeview.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'upstart.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'upstart.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'flagshipcredit.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'flagshipcredit.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'oportun.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'oportun.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'atlanticus.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'atlanticus.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'firsthelpfinancial.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'firsthelpfinancial.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'vervent.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'vervent.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'americancreditacceptance.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'americancreditacceptance.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'enova.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'enova.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'pagaya.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'pagaya.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'navient.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'navient.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'roundpointmortgage.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'roundpointmortgage.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'stellantis-fs.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'stellantis-fs.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'pennymac.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'pennymac.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'berkadia.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'berkadia.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'shellpointmtg.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'shellpointmtg.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'a0e52939-c12d-40cd-b70b-326fe966fc7f', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company with complaint exposure'
FROM organizations o WHERE o.domain = 'mbfs.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'd184c27f-8bd9-43d5-82a9-dbcaea092537', o.id, 7.0, 'discovered', 'Apollo search: auto finance/lending company needing sales compliance'
FROM organizations o WHERE o.domain = 'mbfs.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

-- File 2: SaaS/Fintech/Customer Service -> QA campaign
INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'airwallex.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'coinbase.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'circle.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'checkout.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'neofinancial.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'interactivebrokers.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'greendot.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'home.saxo'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'altisource.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'co-opbank.co.ke'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'm-kopa.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'mukuru.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'gcash.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'modulrfinance.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'sapiens.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'uphold.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'bankunited.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'galileo-ft.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'getevolved.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'marinerfinance.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'nhbc.co.uk'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'elavon.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: SaaS/fintech company for QA automation'
FROM organizations o WHERE o.domain = 'plymouthrock.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

-- Cross-file duplicates: also link to QA campaign
INSERT INTO campaign_organizations (campaign_id, organization_id, relevance_score, status, score_reason)
SELECT 'e3643628-1926-4c9a-ac79-afb0b50f6512', o.id, 7.0, 'discovered', 'Apollo search: cross-segment company (finance + SaaS/fintech)'
FROM organizations o WHERE o.domain = 'sofi.com'
ON CONFLICT (campaign_id, organization_id) DO NOTHING;

COMMIT;