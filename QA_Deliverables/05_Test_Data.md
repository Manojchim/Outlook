# 05 Test Data

## Test Data

| Test Data ID | Category | Purpose | Exact Value | Handling | Status |
| --- | --- | --- | --- | --- | --- |
| TD-001 | Credentials | Valid login | username=admin; password=admin | Secure local test data | Used |
| TD-002 | Credentials | Invalid login | username=admin; password=wrong | Safe test data | Used |
| TD-003 | Security | SQL injection payload | ' OR '1'='1 | Safe approved payload | Used |
| TD-004 | Security | XSS payload | <script>alert(1)</script> | Safe approved payload | Used |
| TD-005 | Location | Valid location | London, Greater London, United Kingdom | Mocked Open-Meteo | Used |
| TD-006 | Location | Invalid location | zzzz-no-place | Mocked empty results | Used |
| TD-007 | Weather | Rain | weather_code=61 | Mocked API | Used |
| TD-008 | Weather | Sunny | weather_code=1 | Mocked API | Used |
| TD-009 | Running | Minimum distance | 1 km | Slider boundary | Used |
| TD-010 | Running | Maximum distance | 42 km | Slider boundary | Used |
| TD-011 | Running | Running types | Daily, Short, Long, Marathon, Trail, Sprint, Treadmill | Actual select values | Used |
| TD-012 | Collection | Brands/models | 15 brands / 40 models | Actual catalog | Used |
| TD-013 | Images | Missing/broken | Pending variants and broken URLs | No images verified | Used partially |
| TD-014 | API | Invalid responses | 503, 504, empty JSON | Mocked provider responses | Used |
