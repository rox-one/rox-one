# Scoped delivery plan

| ID | Owner | Dependency | State | Evidence |
|---|---|---|---|---|
| UP-01 | repair worker | current exact source/DTO/IPC | VERIFIED | hook13543daf matched four refs and published4413 |
| UP-02 | repair worker | UP-01 | VERIFIED RED | actual baseline; same14 cases:2pass/12fail, exit1 |
| UP-03 | repair worker | UP-02 | IMPLEMENTED | source2b87d14; one hook delta |
| UP-04 | repair worker | UP-03 | VERIFIED scoped | actual union catalog wrapper14/0/31; source unchanged |
| UP-05 | independent root reviewer | UP-03 | ACCEPTED scoped | source/delta review; independent original13/0/29 |
| UP-06 | repair worker | UP-04/UP-05 | DELIVERY READY | stacked draft targeting cloud/all-surfaces-20260930; exact readback receipt follows |
| UP-07 | existing Cloud/common owner | UP-06 | NOT INTEGRATED | apply reviewed exact correction to current owned source generation |
| UP-08 | existing Cloud/common owner | UP-07 | NOT RUN | actual composed-app/native/browser acceptance |

No original source branch mutation or merge is performed by this scoped delivery. Existing full program criteria remain open. Root owns integration and overall acceptance.
