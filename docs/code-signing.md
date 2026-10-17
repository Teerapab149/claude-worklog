# ลงลายเซ็นตัวติดตั้งด้วย SignPath

ไฟล์ `Worklog-Setup-*.exe` ที่ไม่มีลายเซ็นดิจิทัลมักโดนโปรแกรมสแกนไวรัสบางเจ้าที่ใช้ machine learning แจ้งว่าน่าสงสัย และ Windows SmartScreen จะขึ้นหน้าเตือนตอนเปิด การลงลายเซ็นช่วยทั้งสองเรื่อง SignPath Foundation ให้ใบรับรองฟรีกับโปรเจกต์ open source ใบรับรองจะออกในชื่อ SignPath Foundation ดังนั้นตอนติดตั้ง Windows จะแสดงผู้เผยแพร่เป็น "SignPath Foundation" ไม่ใช่ชื่อเรา

release.yml เตรียมไว้แล้ว ถ้ายังไม่ตั้งค่าตามขั้นตอนด้านล่าง ระบบจะออก release แบบไม่มีลายเซ็นเหมือนเดิม

## สิ่งที่ต้องพร้อมก่อนสมัคร

1. เปิดการยืนยันตัวตนสองขั้น (2FA) ในบัญชี GitHub ที่ Settings แล้วไปที่ Password and authentication
2. push หัวข้อ "Code signing policy" ใน README.md และ README.en.md ขึ้น GitHub ก่อน เพราะ SignPath จะเข้ามาดูว่ามีข้อความ "Free code signing provided by SignPath.io, certificate by SignPath Foundation" บนหน้าแรกของ repo และหน้า release
3. ใส่ลิงก์ไปที่หัวข้อนั้นในคำอธิบายของ release ด้วย ตัวอย่างข้อความท้าย release notes:
   `Code signing policy: https://github.com/Teerapab149/claude-worklog#code-signing-policy`
4. ต้องมี release ที่ออกไปแล้วอย่างน้อยหนึ่งตัว (ตอนนี้มี 1.0.1 แล้ว)

## ขั้นตอนสมัคร

1. เข้า https://signpath.org/apply แล้วกรอกฟอร์ม ข้อมูลที่ใช้:
   - ชื่อโปรเจกต์: Worklog
   - Repository: https://github.com/Teerapab149/claude-worklog
   - License: MIT
   - Build system: GitHub Actions
   - ไฟล์ที่จะลงลายเซ็น: ตัวติดตั้ง Inno Setup (`Worklog-Setup-<version>.exe`) หนึ่งไฟล์ต่อ release
   - คำอธิบายสั้น ๆ: Windows app ที่อ่าน log ของ Claude Code และ Codex ในเครื่อง แล้วแสดงสถานะงานแต่ละโปรเจกต์บนหน้าเว็บในเครื่อง
2. รออีเมลตอบกลับ ปกติใช้เวลาหลายวันถึงสองสามสัปดาห์ บางครั้งเขาจะถามเพิ่ม ให้ตอบตามจริง
3. เมื่ออนุมัติแล้วจะได้คำเชิญเข้า https://app.signpath.io ให้ login และเปิด 2FA ในบัญชี SignPath ด้วย

## ตั้งค่าใน SignPath

SignPath Foundation มักสร้างโปรเจกต์และ signing policy ให้แล้ว ให้ตรวจและเติมส่วนที่ขาด

1. Trusted build system: ผูก GitHub.com เข้ากับโปรเจกต์ เพื่อให้รับเฉพาะไฟล์ที่สร้างจาก GitHub Actions ของ repo นี้
2. Artifact configuration: สร้างอันใหม่ ตั้ง slug เช่น `installer` แล้ววาง XML นี้ (GitHub จะ zip ไฟล์ตอนส่งไป จึงขึ้นต้นด้วย `zip-file`)

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="Worklog-Setup-*.exe" product-name="Worklog">
         <authenticode-sign/>
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

   `product-name="Worklog"` คือการจำกัดว่าจะลงลายเซ็นเฉพาะไฟล์ที่ชื่อผลิตภัณฑ์ตรงกับ `VersionInfoProductName` ใน `installer/worklog.iss` ซึ่ง SignPath Foundation บังคับให้ตั้ง
3. Signing policy: ใช้ policy ที่เขาสร้างให้ (ส่วนใหญ่ชื่อ `release-signing`) และตั้งให้ Teerapab149 เป็น Approver
4. API token: ไปที่ Users แล้วสร้าง CI user ให้สิทธิ์ Submitter ใน signing policy นั้น จากนั้นสร้าง API token ของ user นี้แล้วคัดลอกเก็บไว้ (จะเห็นได้ครั้งเดียว)
5. จด Organization ID จากหน้า Settings ขององค์กร และ slug ของ project, signing policy และ artifact configuration

## ตั้งค่าใน GitHub

ที่หน้า repo ไปที่ Settings แล้วเลือก Secrets and variables และ Actions

แท็บ Secrets ให้เพิ่ม:

- `SIGNPATH_API_TOKEN` ใส่ API token จากข้อ 4

แท็บ Variables ให้เพิ่ม:

- `SIGNPATH_ORGANIZATION_ID` ใส่ Organization ID
- `SIGNPATH_PROJECT_SLUG` ใส่ slug ของโปรเจกต์ เช่น `claude-worklog`
- `SIGNPATH_SIGNING_POLICY_SLUG` เช่น `release-signing`
- `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` เช่น `installer`

พอมี `SIGNPATH_ORGANIZATION_ID` แล้ว release ครั้งต่อไปจะส่งไปลงลายเซ็นเอง

## ออก release ที่มีลายเซ็น

1. แก้ `version` ใน `package.json` แล้ว push tag เหมือนเดิม
2. รอให้ GitHub Actions ทำถึงขั้น "Sign it with SignPath" แล้วเข้า https://app.signpath.io กด Approve ที่ signing request ใหม่ ต้องกดภายใน 1 ชั่วโมง ไม่อย่างนั้นงานจะล้มและต้องรันใหม่
3. ขั้น "Check the signature" จะตรวจว่าลายเซ็นใช้ได้ก่อนแนบไฟล์เข้า release
4. ทดสอบในเครื่อง: คลิกขวาที่ไฟล์ แล้วเลือก Properties จะมีแท็บ Digital Signatures ที่ขึ้นชื่อ SignPath Foundation

## สิ่งที่ควรรู้

- ลายเซ็นไม่ได้ทำให้ทุกเจ้าหยุดแจ้งทันที แต่ลดโอกาสได้มาก ถ้ายังมีเจ้าไหนแจ้งอยู่ ให้ส่งไฟล์ไปแจ้งว่าแจ้งผิด (false positive) กับเจ้านั้นโดยตรง
- SmartScreen ดูทั้งลายเซ็นและจำนวนคนที่ดาวน์โหลด ช่วงแรกอาจยังขึ้นเตือนอยู่ แต่จะหายไปเมื่อมีคนใช้มากพอ
- ตัวถอนการติดตั้ง (unins000.exe) ที่ Inno Setup สร้างไว้ข้างในจะยังไม่มีลายเซ็น ส่วน node.exe ที่แนบไปมีลายเซ็นของ OpenJS Foundation อยู่แล้ว
- เงื่อนไขของ SignPath Foundation บอกว่าโปรแกรมที่ส่งข้อมูลออกนอกเครื่องต้องแสดงนโยบายความเป็นส่วนตัวระหว่างติดตั้ง และให้ปิดได้ Worklog อธิบายไว้ใน README และปิดการอัปเดตกับการสรุปด้วย AI ได้ในหน้าตั้งค่าแล้ว ถ้าผู้ตรวจขอให้แสดงตอนติดตั้งด้วย ให้เพิ่ม `InfoBeforeFile` ใน `installer/worklog.iss`
- ผู้ที่ลงลายเซ็นต้องเป็นคนดูแล repo นี้เอง และต้องกดอนุมัติเองทุก release ห้ามตั้งให้อนุมัติอัตโนมัติ
