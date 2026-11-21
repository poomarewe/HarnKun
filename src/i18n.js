import { useSyncExternalStore } from 'react';

// Languages the app can show. The first supported language in the device's
// preference list wins; English is the fallback.
const LANGUAGES = ['en', 'th'];
const STORAGE_KEY = 'harn-kun-lang';

export const PAGE_TITLE = 'Harn Kun | Free Bill Splitter for Friends';
export const PAGE_DESCRIPTION = 'Split bills with friends for free. Add items manually or scan a receipt, assign each cost, and share a clear payment breakdown — no account needed.';

const listeners = new Set();

function readSavedLanguage() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return LANGUAGES.includes(saved) ? saved : null;
  } catch {
    return null;
  }
}

function detectDeviceLanguage() {
  const preferred = typeof navigator !== 'undefined' && navigator.languages?.length
    ? navigator.languages
    : [typeof navigator !== 'undefined' ? navigator.language : 'en'];
  for (const tag of preferred) {
    const base = String(tag || '').toLowerCase().split('-')[0];
    if (LANGUAGES.includes(base)) return base;
  }
  return 'en';
}

let currentLanguage = readSavedLanguage() || detectDeviceLanguage();

if (typeof document !== 'undefined') {
  document.documentElement.lang = currentLanguage;
}

export function getLanguage() {
  return currentLanguage;
}

export function setLanguage(language) {
  if (!LANGUAGES.includes(language) || language === currentLanguage) return;
  currentLanguage = language;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // The choice still applies for this visit when storage is unavailable.
  }
  document.documentElement.lang = language;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Translates a English UI string into the current language. Placeholders such as
// {count} are filled from `values`. Strings without a translation stay English.
export function t(text, values) {
  const translated = currentLanguage === 'th' && Object.prototype.hasOwnProperty.call(TH, text)
    ? TH[text]
    : text;
  if (!values) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  ));
}

// Locale for Intl date and time formats. Thai dates use the Gregorian calendar.
export function intlLocale() {
  return currentLanguage === 'th' ? 'th-TH-u-ca-gregory' : undefined;
}

// Re-renders the component whenever the language changes.
export function useLanguage() {
  const language = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return { lang: language, setLanguage };
}

const TH = {
  'A short name makes this bill easy to find later.': 'ตั้งชื่อสั้น ๆ จะช่วยให้หาบิลนี้เจอได้ง่ายขึ้นภายหลัง',
  'Add VAT': 'เพิ่ม VAT',
  'Add a name for this bill before continuing.': 'ตั้งชื่อบิลก่อนดำเนินการต่อ',
  'Add an item': 'เพิ่มรายการ',
  'Add an item name and a valid price.': 'กรอกชื่อรายการและราคาที่ถูกต้อง',
  'Add another item.': 'เพิ่มรายการอีก',
  'Add another item?': 'เพิ่มรายการอีกไหม?',
  'Add at least one bill item before splitting.': 'เพิ่มรายการอย่างน้อยหนึ่งรายการก่อนแบ่งบิล',
  'Add discount': 'เพิ่มส่วนลด',
  'Add everyone who joined. You can remove a name before continuing.': 'เพิ่มทุกคนที่ร่วมจ่าย คุณลบชื่อได้ก่อนไปขั้นตอนต่อไป',
  'Add friends, scan, and split in a few taps': 'เพิ่มเพื่อน สแกน และแบ่งบิลได้ในไม่กี่แตะ',
  'Add item': 'เพิ่มรายการ',
  'Add items one by one': 'เพิ่มทีละรายการ',
  'Add person': 'เพิ่มคน',
  'Add quantity': 'เพิ่มจำนวน',
  'Add tax or a discount if the bill needs it.': 'เพิ่มภาษีหรือส่วนลดได้ ถ้าบิลต้องการ',
  'Add your first item or choose a receipt photo. Items will appear here as you go.': 'เพิ่มรายการแรกหรือเลือกรูปใบเสร็จ รายการจะปรากฏที่นี่เมื่อคุณเพิ่ม',
  'Add your people.': 'เพิ่มคนที่ร่วมจ่าย',
  'Add {count} more': 'เพิ่มอีก {count} คน',
  'Adjust your photo': 'ปรับรูปภาพ',
  'All shared fairly.': 'แบ่งกันอย่างยุติธรรม',
  'Anyone with this QR can view this bill.': 'ใครที่มี QR นี้ก็ดูบิลนี้ได้',
  'At least 2 needed': 'ต้องมีอย่างน้อย 2 คน',
  'Back': 'ย้อนกลับ',
  'Back online': 'กลับมาออนไลน์แล้ว',
  'Bill': 'บิล',
  'Bill name': 'ชื่อบิล',
  'Name': 'ชื่อ',
  'Bill QR code': 'QR โค้ดของบิล',
  'Bill complete': 'บิลเสร็จสมบูรณ์',
  'Bill controls': 'ตัวควบคุมบิล',
  'Bill details could not load. Tap the bill to try again.': 'โหลดรายละเอียดบิลไม่สำเร็จ แตะที่บิลเพื่อลองอีกครั้ง',
  'Bill items': 'รายการในบิล',
  'Bill options': 'ตัวเลือกบิล',
  'Bill photo': 'รูปบิล',
  'Bill photo preview': 'ดูตัวอย่างรูปบิล',
  'Bill progress': 'ความคืบหน้าของบิล',
  'Bill summary': 'สรุปบิล',
  'Bill to crop': 'บิลที่จะครอบตัด',
  'Calculating…': 'กำลังคำนวณ…',
  'Cancel': 'ยกเลิก',
  'Change': 'เปลี่ยน',
  'Check available browser storage and retry.': 'ตรวจสอบพื้นที่จัดเก็บของเบราว์เซอร์แล้วลองอีกครั้ง',
  'Check every item name, non-negative price, whole quantity, VAT (0–100%), and discount before continuing.': 'ตรวจชื่อรายการ ราคา (ไม่ติดลบ) จำนวนเต็ม VAT (0–100%) และส่วนลดให้ถูกต้องก่อนดำเนินการต่อ',
  'Choose a photo': 'เลือกรูปภาพ',
  'Choose a way to start.': 'เลือกวิธีเริ่มต้น',
  'Choose again': 'เลือกใหม่',
  'Choose at least one person for this item.': 'เลือกอย่างน้อยหนึ่งคนสำหรับรายการนี้',
  'Clear all': 'ล้างทั้งหมด',
  'Clear history': 'ล้างประวัติ',
  'Close': 'ปิด',
  'Close QR code': 'ปิด QR โค้ด',
  'Close bill photo': 'ปิดรูปบิล',
  'Close history menu': 'ปิดเมนูประวัติ',
  'Completed details': 'รายละเอียดที่กรอกแล้ว',
  'Confirm photo': 'ยืนยันรูปภาพ',
  'Contact (optional)': 'ช่องทางติดต่อ (ไม่บังคับ)',
  'Continue to bill': 'ไปขั้นตอนบิล',
  'Continue your bill': 'กลับไปทำบิลต่อ',
  'Could not clear history. Please try again.': 'ล้างประวัติไม่สำเร็จ กรุณาลองอีกครั้ง',
  'Could not compress this photo.': 'บีบอัดรูปนี้ไม่สำเร็จ',
  'Could not create the summary picture.': 'สร้างรูปสรุปไม่สำเร็จ',
  'Could not crop this photo. Please try again.': 'ครอบตัดรูปนี้ไม่สำเร็จ กรุณาลองอีกครั้ง',
  'Could not delete this bill. Please try again.': 'ลบบิลนี้ไม่สำเร็จ กรุณาลองอีกครั้ง',
  'Could not download the summary picture.': 'ดาวน์โหลดรูปสรุปไม่สำเร็จ',
  'Could not open this bill': 'เปิดบิลนี้ไม่ได้',
  'Could not prepare this photo.': 'เตรียมรูปนี้ไม่สำเร็จ',
  'Could not scan this photo: {message}': 'สแกนรูปนี้ไม่สำเร็จ: {message}',
  'Could not send your message.': 'ส่งข้อความไม่สำเร็จ',
  'Create a bill with Harn Kun': 'สร้างบิลกับ Harn Kun',
  'Create your first bill': 'สร้างบิลแรกของคุณ',
  'Create your first bill split and it will appear here.': 'สร้างการแบ่งบิลแรกแล้วจะปรากฏที่นี่',
  'Crop bill photo': 'ครอบตัดรูปบิล',
  'DELETE HISTORY': 'ลบประวัติ',
  'Delete': 'ลบ',
  'Delete item': 'ลบรายการ',
  'Delete {name}': 'ลบ {name}',
  'Discount': 'ส่วนลด',
  'Discount in baht': 'ส่วนลด (บาท)',
  'Done': 'เสร็จสิ้น',
  'Download as picture': 'ดาวน์โหลดเป็นรูปภาพ',
  'Download picture': 'ดาวน์โหลดรูป',
  'Each person owes': 'แต่ละคนต้องจ่าย',
  'Edit': 'แก้ไข',
  'Edit this bill': 'แก้ไขบิลนี้',
  'Edit {name}': 'แก้ไข {name}',
  'Enlarge this bill QR code': 'ขยาย QR โค้ดของบิลนี้',
  'Entertainment': 'บันเทิง',
  'Every item has its place.': 'ทุกรายการมีที่ของมัน',
  'Food & drink': 'อาหารและเครื่องดื่ม',
  'General expense': 'ค่าใช้จ่ายทั่วไป',
  'Generating QR code': 'กำลังสร้าง QR โค้ด',
  'Give this bill a name.': 'ตั้งชื่อบิลนี้',
  'Go to Harn Kun': 'ไปที่ Harn Kun',
  'Go to Harn Kun home': 'ไปหน้าแรก Harn Kun',
  'Good times, shared fairly.': 'สนุกกันได้ แบ่งกันอย่างยุติธรรม',
  'Health': 'สุขภาพ',
  'Here is what each person owes. This bill has not been saved on this device.': 'นี่คือยอดที่แต่ละคนต้องจ่าย บิลนี้ยังไม่ได้บันทึกไว้ในเครื่องนี้',
  'Here is what each person owes. This bill is saved in Recent bills.': 'นี่คือยอดที่แต่ละคนต้องจ่าย บิลนี้ถูกบันทึกไว้ในบิลล่าสุดแล้ว',
  'Hide keyboard': 'ซ่อนคีย์บอร์ด',
  'Hide quantity': 'ซ่อนจำนวน',
  'High total': 'ยอดสูงสุด',
  'Highest total': 'ยอดสูงสุดก่อน',
  'History': 'ประวัติ',
  'How should we add the bill?': 'จะเพิ่มบิลอย่างไรดี?',
  'INVALID LINK': 'ลิงก์ไม่ถูกต้อง',
  'ITEM TOTAL': 'ยอดรวมรายการ',
  'ITEMS & SHARING': 'รายการและการแบ่ง',
  'Item assignments': 'การแบ่งรายการ',
  'Item name': 'ชื่อรายการ',
  'Item or expense': 'รายการหรือค่าใช้จ่าย',
  'Item {n} of {total}': 'รายการที่ {n} จาก {total}',
  'Items and sharing': 'รายการและการแบ่ง',
  'Items on this bill': 'รายการในบิลนี้',
  'Large QR code for this bill\'s read-only details': 'QR โค้ดขนาดใหญ่สำหรับดูรายละเอียดบิลแบบอ่านอย่างเดียว',
  'Large preview of the selected bill': 'ดูตัวอย่างบิลที่เลือกแบบขยาย',
  'Line total': 'ยอดรวมรายการ',
  'Loading recent bills': 'กำลังโหลดบิลล่าสุด',
  'Loading shared bill': 'กำลังโหลดบิลที่แชร์',
  'Low total': 'ยอดต่ำสุด',
  'Lowest total': 'ยอดต่ำสุดก่อน',
  'Message': 'ข้อความ',
  'Move the receipt into the frame, then confirm.': 'จัดใบเสร็จให้อยู่ในกรอบ แล้วกดยืนยัน',
  'Name or LINE ID': 'ชื่อหรือ LINE ID',
  'Newest': 'ใหม่สุด',
  'Next item': 'รายการถัดไป',
  'Next: add people': 'ถัดไป: เพิ่มคน',
  'No bill items were detected. Add them manually or try a clearer photo.': 'ไม่พบรายการในบิล เพิ่มเองหรือลองถ่ายรูปให้ชัดขึ้น',
  'No bills yet': 'ยังไม่มีบิล',
  'No one selected': 'ยังไม่ได้เลือกใคร',
  'No people selected for this item.': 'ยังไม่ได้เลือกคนสำหรับรายการนี้',
  'Now sharing': 'กำลังแบ่ง',
  'ON THIS DEVICE': 'บนเครื่องนี้',
  'Oldest': 'เก่าสุด',
  'Open bill detail ↗': 'เปิดรายละเอียดบิล ↗',
  'Open history menu': 'เปิดเมนูประวัติ',
  'Open the full item and payment': 'เปิดดูรายการและการชำระเงินทั้งหมด',
  'Open the real read-only bill link': 'เปิดลิงก์บิลแบบอ่านอย่างเดียว',
  'PAYMENT BREAKDOWN': 'รายละเอียดการชำระ',
  'PEOPLE': 'คน',
  'PEOPLE ON THIS BILL': 'ผู้ร่วมในบิลนี้',
  'PERSON': 'คน',
  'People': 'ผู้ร่วม',
  'People sharing this bill': 'ผู้ร่วมแบ่งบิลนี้',
  'Please choose a photo of the bill.': 'กรุณาเลือกรูปบิล',
  'Please choose an image of the bill.': 'กรุณาเลือกรูปของบิล',
  'Please think before sending. The admin who reads this gets sad.': 'กรุณาคิดให้ดีก่อนส่ง แอดมินที่อ่านจะเสียใจ',
  'Please wait {seconds} seconds before scanning another bill.': 'กรุณารอ {seconds} วินาทีก่อนสแกนบิลอีกใบ',
  'Preparing photo': 'กำลังเตรียมรูป',
  'Preparing…': 'กำลังเตรียม…',
  'Previous item': 'รายการก่อนหน้า',
  'Prices must be between 0 and {max} baht.': 'ราคาต้องอยู่ระหว่าง 0 ถึง {max} บาท',
  'QR code for this bill\'s read-only details': 'QR โค้ดสำหรับดูรายละเอียดบิลแบบอ่านอย่างเดียว',
  'Qty': 'จำนวน',
  'Quantity': 'จำนวน',
  'Quantity must be at least 1.': 'จำนวนต้องอย่างน้อย 1',
  'READ ONLY': 'อ่านอย่างเดียว',
  'READY WHEN YOU ARE': 'พร้อมเมื่อคุณพร้อม',
  'Reading your receipt…': 'กำลังอ่านใบเสร็จ…',
  'Receipt photo': 'รูปใบเสร็จ',
  'Recent bills': 'บิลล่าสุด',
  'Recent bills are unavailable. Check browser storage permissions and try again.': 'บิลล่าสุดใช้ไม่ได้ ตรวจสอบสิทธิ์การจัดเก็บของเบราว์เซอร์แล้วลองอีกครั้ง',
  'Remove all bills': 'ลบบิลทั้งหมด',
  'Remove all bills?': 'ลบบิลทั้งหมดไหม?',
  'Removing…': 'กำลังลบ…',
  'Rent & home': 'บ้านและที่พัก',
  'Retake': 'ถ่ายใหม่',
  'Retry saving': 'ลองบันทึกอีกครั้ง',
  'Review the items, then move on when everything looks right.': 'ตรวจรายการ แล้วไปต่อเมื่อถูกต้องครบ',
  'SCAN TO SEE BILL DETAILS': 'สแกนเพื่อดูรายละเอียดบิล',
  'SHARED BILL': 'บิลที่แชร์',
  'SHARED RECEIPT': 'ใบเสร็จที่แชร์',
  'SHARED WITH': 'แชร์กับ',
  'Scan to see full detail': 'สแกนเพื่อดูรายละเอียดทั้งหมด',
  'Scroll Down': 'เลื่อนลง',
  'See the split': 'ดูการแบ่ง',
  'Select all': 'เลือกทั้งหมด',
  'Select at least one person to continue.': 'เลือกอย่างน้อยหนึ่งคนเพื่อดำเนินการต่อ',
  'Selected receipt': 'ใบเสร็จที่เลือก',
  'Send': 'ส่ง',
  'Send a message to the admin': 'ส่งข้อความถึงแอดมิน',
  'Sending…': 'กำลังส่ง…',
  'Share one item at a time.': 'แบ่งทีละรายการ',
  'Share this bill': 'แชร์บิลนี้',
  'Shared bill details': 'รายละเอียดบิลที่แชร์',
  'Sharing': 'การแบ่ง',
  'Shopping': 'ช้อปปิ้ง',
  'Sort recent bills': 'เรียงบิลล่าสุด',
  'Split a bill': 'แบ่งบิล',
  'Split bills with friends, scan receipts, and see who owes what.': 'หารบิลกับเพื่อน สแกนใบเสร็จ และดูว่าใครต้องจ่ายเท่าไร',
  'Split the bill with your people, minus the awkward math.': 'หารบิลกับเพื่อนแบบไม่ต้องคิดเลขให้ปวดหัว',
  'Step {n} of 4': 'ขั้นตอนที่ {n} จาก 4',
  'Subtotal': 'ยอดก่อนภาษี',
  'Summary': 'สรุป',
  'Switch to English': 'เปลี่ยนเป็นภาษาอังกฤษ',
  'Switch to Thai': 'เปลี่ยนเป็นภาษาไทย',
  'TOTAL': 'ยอดรวม',
  'Take a photo': 'ถ่ายรูป',
  'Take a photo, upload one, or enter items yourself.': 'ถ่ายรูป อัปโหลดรูป หรือกรอกรายการเอง',
  'Tap everyone who shared this item. We will divide its price evenly.': 'แตะทุกคนที่แชร์รายการนี้ เราจะหารราคาเท่า ๆ กัน',
  'Tap to view': 'แตะเพื่อดู',
  'Tell admin': 'ส่งข้อความถึงแอดมิน',
  'The bill form could not load. Tap Split a bill to retry.': 'โหลดฟอร์มบิลไม่สำเร็จ แตะแบ่งบิลเพื่อลองอีกครั้ง',
  'This bill can contain up to 1,000 items.': 'บิลนี้มีได้สูงสุด 1,000 รายการ',
  'This bill is shared as read-only.': 'บิลนี้ถูกแชร์แบบอ่านอย่างเดียว',
  'This image could not be opened. Choose a supported photo or type the items instead.': 'เปิดรูปนี้ไม่ได้ เลือกรูปที่รองรับหรือพิมพ์รายการเอง',
  'This photo is still too large after compression.': 'รูปยังใหญ่เกินไปแม้จะบีบอัดแล้ว',
  'This shared bill link is missing its bill details.': 'ลิงก์บิลที่แชร์ขาดรายละเอียดบิล',
  'This shared receipt link is invalid or incomplete.': 'ลิงก์ใบเสร็จที่แชร์ไม่ถูกต้องหรือไม่สมบูรณ์',
  'This split could not be saved. Keep this page open or download a picture. {detail}': 'บันทึกการแบ่งนี้ไม่สำเร็จ เปิดหน้านี้ไว้หรือดาวน์โหลดรูปไว้ก่อน {detail}',
  'This will permanently remove all {count} bills stored on this device.': 'จะลบบิล {count} ใบที่เก็บไว้ในเครื่องนี้อย่างถาวร',
  'Today': 'วันนี้',
  'Total': 'รวม',
  'Total amount to pay': 'ยอดที่ต้องจ่าย',
  'Total price': 'ราคารวม',
  'Total shared': 'ยอดรวมที่แบ่ง',
  'Travel': 'เดินทาง',
  'Type a name': 'พิมพ์ชื่อ',
  'Type it in': 'พิมพ์เอง',
  'Unknown scanning error': 'ไม่ทราบสาเหตุ',
  'Unnamed item': 'ไม่มีชื่อรายการ',
  'Upload a receipt': 'อัปโหลดใบเสร็จ',
  'Use a photo instead': 'ใช้รูปแทน',
  'Use the item name and full price. You can edit it in the list afterward.': 'ใส่ชื่อรายการและราคาเต็ม แก้ไขในรายการได้ภายหลัง',
  'Use your camera': 'ใช้กล้องของคุณ',
  'Utilities': 'ค่าสาธารณูปโภค',
  'VAT': 'VAT',
  'VAT percentage': 'เปอร์เซ็นต์ VAT',
  'View receipt photo': 'ดูรูปใบเสร็จ',
  'What happened?': 'เกิดอะไรขึ้น?',
  'What is the first item?': 'รายการแรกคืออะไร?',
  'What was the occasion?': 'งานนี้คืออะไร?',
  'Who had this?': 'ใครร่วมรายการนี้?',
  'Who is splitting?': 'ใครจะร่วมแบ่งบ้าง?',
  'Who pays': 'ใครต้องจ่าย',
  'Yesterday': 'เมื่อวาน',
  'You can add up to 100 people.': 'เพิ่มได้สูงสุด 100 คน',
  'You can scan another photo in {seconds}s, or type items now.': 'สแกนรูปอีกใบได้ใน {seconds} วินาที หรือพิมพ์รายการตอนนี้ได้เลย',
  'Your bill': 'บิลของคุณ',
  'Your bill draft is safe, but its form could not load. Tap Continue your bill to retry.': 'ร่างบิลของคุณยังปลอดภัย แต่ฟอร์มโหลดไม่ได้ แตะกลับไปทำบิลต่อเพื่อลองอีกครั้ง',
  'Your bill, made clear.': 'บิลของคุณ ชัดเจนแล้ว',
  'Your current item is still waiting in Add item.': 'รายการปัจจุบันของคุณยังรอในช่องเพิ่มรายการ',
  'You’re offline': 'คุณกำลังออฟไลน์',
  'breakdown on any phone': 'ดูได้บนโทรศัพท์ทุกเครื่อง',
  'complete': 'เสร็จแล้ว',
  'e.g. Friday dinner': 'เช่น อาหารเย็นวันศุกร์',
  'e.g. Pizza': 'เช่น พิซซ่า',
  'item': 'รายการ',
  'items': 'รายการ',
  'of bill': 'ของบิล',
  'people': 'คน',
  'shared items': 'รายการที่แชร์',
  'split between': 'แบ่งกับ',
  '← Back to bill': '← กลับไปที่บิล',
  '{count} saved bill(s) could not be displayed. Their data has been kept on this device.': 'แสดงบิลที่บันทึกไว้ {count} ใบไม่ได้ ข้อมูลยังถูกเก็บไว้ในเครื่องนี้',
  '{count} selected · Any extra satang goes to the first selected people.': 'เลือกแล้ว {count} คน · สตางค์ที่เหลือจะไปให้คนที่เลือกคนแรก',
  '{name} is already in the list.': '{name} อยู่ในรายชื่อแล้ว',
  '{stage} step': 'ขั้นตอน{stage}',
  'Harn Kun | Free Bill Splitter for Friends': 'Harn Kun | แอปหารบิลฟรีสำหรับเพื่อน',
  'Split bills with friends for free. Add items manually or scan a receipt, assign each cost, and share a clear payment breakdown — no account needed.': 'หารบิลกับเพื่อนฟรี เพิ่มรายการเองหรือสแกนใบเสร็จ กำหนดค่าใช้จ่ายแต่ละคน และแชร์สรุปการชำระที่ชัดเจน ไม่ต้องสมัครสมาชิก',
};
