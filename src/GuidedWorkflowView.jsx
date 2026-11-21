import React, { useRef } from 'react';
import DoodleField, { Doodle } from './DecorativeDoodles';
import { itemShare } from './money.js';
import { t } from './i18n';

const stageNames = ['People', 'Bill', 'Sharing', 'Summary'];

export default function GuidedWorkflowView({ flow }) {
  const {
    BitsButton, BitsSurface, isWorkflowClosing, workflowDirection, step, splitIndex,
    eventName, friendName, friends, error, billItems, billImageUrl, ocrStatus,
    ocrProgress, cooldownRemaining, cameraFlow, pendingCameraUrl, cropAspect,
    cropBaseSize, cropTransform, isCropping, editingBillIndex, vatEnabled, vatRate,
    discountEnabled, discountAmount, subtotal, vatAmount, appliedDiscount, total,
    allocations, isSaving, settlements, historySaved, finishSplitting, peopleNameConfirmed, manualComposerOpen,
    manualItemName, manualItemPrice, manualQuantity, showManualQuantity, showBillExtras,
    inputRef, manualNameRef, cameraInputRef, uploadInputRef, cropWorkspaceRef,
    cropFrameRef, cropImageRef, billListRef, billEditorRef,
    closePanel, closeCameraFlow, guidedGoBack, setEventName, setFriendName, addFriend, removeFriend,
    setPeopleNameConfirmed, continueToBill, startCameraFlow, chooseCameraBill,
    chooseBill, beginCropDrag, moveCropDrag, endCropDrag, zoomCropWithWheel,
    toggleCropAspect, initializeCropEditor, confirmCameraBill, setBillPhotoOpen,
    setManualComposerOpen, setManualItemName, setManualItemPrice, setManualQuantity,
    setShowManualQuantity, setShowBillExtras, addManualItemFromComposer,
    setEditingBillIndex, updateBillItem, removeBillItem, setVatEnabled, setVatRate,
    setDiscountEnabled, setDiscountAmount, startSplitting, toggleFriendForItem,
    toggleAllFriendsForItem, goToPreviousFood, goToNextFood, downloadSummary,
    finishOperation, selectWholeValue,
  } = flow;

  const stageIndex = ({ friends: 0, bill: 1, split: 2, result: 3 })[step] ?? 0;
  const selectedFriends = allocations[splitIndex] || [];
  const currentItem = billItems[splitIndex];
  const hasItems = billItems.some((item) => item.name.trim());
  const hasPendingItem = manualComposerOpen && (manualItemName.trim() || manualItemPrice !== '');
  const priceInputRef = useRef(null);
  const quantityInputRef = useRef(null);
  const showMobileItemAction = step === 'bill' && !cameraFlow && ocrStatus !== 'scanning'
    && editingBillIndex === null && manualComposerOpen && !showBillExtras && (hasPendingItem || !hasItems);
  const dismissKeyboard = () => document.activeElement?.blur();
  const finishEditing = () => { dismissKeyboard(); setEditingBillIndex(null); };
  const confirmName = (event) => { event?.preventDefault(); if (!eventName.trim()) return; dismissKeyboard(); setPeopleNameConfirmed(true); };
  const focusPrice = (event) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    priceInputRef.current?.focus();
  };
  const toggleQuantity = () => {
    setShowManualQuantity((open) => !open);
    if (!showManualQuantity) window.requestAnimationFrame(() => quantityInputRef.current?.focus());
  };
  const titles = {
    friends: peopleNameConfirmed ? t("Who is splitting?") : t("Give this bill a name."),
    bill: hasItems ? t("Your bill, made clear.") : t("How should we add the bill?"),
    split: t("Share one item at a time."),
    result: t("All shared fairly."),
  };
  const descriptions = {
    friends: peopleNameConfirmed ? t("Add everyone who joined. You can remove a name before continuing.") : t("A short name makes this bill easy to find later."),
    bill: hasItems ? t("Review the items, then move on when everything looks right.") : t("Take a photo, upload one, or enter items yourself."),
    split: t("Tap everyone who shared this item. We will divide its price evenly."),
    result: historySaved ? t("Here is what each person owes. This bill is saved in Recent bills.") : t("Here is what each person owes. This bill has not been saved on this device."),
  };

  return (
    <div className={`overlay${isWorkflowClosing ? ' is-closing' : ''}`} role="presentation" onMouseDown={closePanel}>
      <BitsSurface
        as="section"
        key={`${step}-${step === 'split' ? splitIndex : ''}`}
        className={`operation-panel guided-flow direction-${workflowDirection} step-${step}${editingBillIndex !== null ? ' is-editing-item' : ''}${showMobileItemAction ? ' has-mobile-item-action' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t('{stage} step', { stage: t(stageNames[stageIndex]) })}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="guided-header">
          <div className="guided-brand"><span aria-hidden="true">✳</span> {t("Harn Kun")}</div>
          <span className="guided-header-step">{t(stageNames[stageIndex])} · {stageIndex + 1}/4</span>
          <div className="guided-header-actions">
            <BitsButton type="button" className="guided-keyboard-dismiss" onClick={dismissKeyboard} aria-label={t("Hide keyboard")} title={t("Hide keyboard")}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="11" rx="2" /><path d="M6 6h1m3 0h1m3 0h1m3 0h.1M6 10h12m-10 8 4 3 4-3" /></svg></BitsButton>
            <BitsButton type="button" className="guided-back" onClick={guidedGoBack} disabled={isSaving || ocrStatus === 'scanning'} aria-label={t("Back")}>←</BitsButton>
            <BitsButton type="button" className="guided-close" onClick={closePanel} aria-label={t("Close")}>×</BitsButton>
          </div>
        </header>

        <DoodleField
          variant={step === 'friends' ? 'friends' : step === 'bill' ? 'bill' : step === 'split' ? 'sharing' : 'summary'}
          className="guided-doodle-field"
        />

        <div className="guided-body">
          <ol className="guided-stages" aria-label={t("Bill progress")}>
            {stageNames.map((name, index) => (
              <li className={`guided-stage${index < stageIndex ? ' is-complete' : ''}${index === stageIndex ? ' is-current' : ''}`} aria-current={index === stageIndex ? 'step' : undefined} key={name}>
                <span aria-hidden="true">{index < stageIndex ? '✓' : index + 1}</span>{t(name)}
              </li>
            ))}
          </ol>
          <section className="guided-intro">
            <span className="guided-kicker">{step === 'split' ? t('Item {n} of {total}', { n: splitIndex + 1, total: billItems.length }) : t('Step {n} of 4', { n: stageIndex + 1 })}</span>
            <h2 className="guided-title">{titles[step]}</h2>
            <p className="guided-description">{descriptions[step]}</p>
          </section>

          {(step !== 'friends' || peopleNameConfirmed) && (
            <ul className="guided-trail" aria-label={t("Completed details")}>
              {eventName.trim() && <li className="guided-trail-item">{eventName}</li>}
              {step !== 'friends' && <li className="guided-trail-item">{friends.length} {t('people')}</li>}
              {(step === 'split' || step === 'result') && <li className="guided-trail-item">{billItems.length} {t('items')} · ฿{total.toFixed(2)}</li>}
            </ul>
          )}

          {step === 'friends' && !peopleNameConfirmed && (
            <form id="guided-bill-name" className="guided-card" onSubmit={confirmName}>
              <h3 className="guided-prompt">{t("What was the occasion?")}</h3>
              <label className="guided-field" htmlFor="bill-event-name">{t("Bill name")}
                <input id="bill-event-name" type="text" value={eventName} onChange={(event) => setEventName(event.target.value)} maxLength={80} placeholder={t("e.g. Friday dinner")} autoComplete="off" enterKeyHint="next" required autoFocus />
              </label>
            </form>
          )}

          {step === 'friends' && peopleNameConfirmed && (
            <div className="guided-card">
              <h3 className="guided-prompt">{t("Add your people.")}</h3>
              <form className="guided-composer guided-people-composer" onSubmit={addFriend} autoComplete="off" data-form-type="other">
                <label className="guided-field" htmlFor="friend-name">{t("Name")}
                  <input ref={inputRef} id="friend-name" name="friend-name-entry" type="text" value={friendName} onChange={(event) => setFriendName(event.target.value)} placeholder={t("Type a name")} maxLength={60} disabled={friends.length >= 100} enterKeyHint="done" autoComplete="off" data-lpignore="true" />
                </label>
                <BitsButton type="submit" className="guided-action" disabled={!friendName.trim() || friends.length >= 100}>{t("Add person")}</BitsButton>
              </form>
              <div className="guided-list-heading"><strong>{friends.length} people added</strong><span>{t("At least 2 needed")}</span></div>
              <div className="guided-chip-list" aria-live="polite">
                {friends.map((friend, index) => (
                  <BitsButton type="button" className="guided-chip" key={`${friend}-${index}`} onClick={() => removeFriend(index)} aria-label={`Remove ${friend}`}>
                    {friend}<span aria-hidden="true">×</span>
                  </BitsButton>
                ))}
              </div>
            </div>
          )}

          {step === 'bill' && (
            <>
              <input ref={cameraInputRef} className="hidden-file-input" type="file" accept="image/*" capture="environment" onChange={chooseCameraBill} />
              <input ref={uploadInputRef} className="hidden-file-input" type="file" accept="image/*" onChange={chooseBill} />
              <div className={`guided-workspace guided-workspace-bill${!hasItems ? ' is-empty' : ''}`}>
                <div className="guided-main">
              {!cameraFlow && billImageUrl && (
                <div className="guided-photo-row">
                  <BitsButton type="button" className="guided-photo-thumb" onClick={() => setBillPhotoOpen(true)} aria-label={t("View receipt photo")}><img src={billImageUrl} alt={t("Selected receipt")} /></BitsButton>
                  <div><strong>{ocrStatus === 'scanning' ? t("Reading your receipt…") : t("Receipt photo")}</strong><small>{t("Tap to view")}</small></div>
                  {ocrStatus !== 'scanning' && <BitsButton type="button" className="guided-secondary" disabled={cooldownRemaining > 0} onClick={() => uploadInputRef.current?.click()}>{cooldownRemaining > 0 ? `${cooldownRemaining}s` : t('Change')}</BitsButton>}
                </div>
              )}

              {!cameraFlow && ocrStatus === 'scanning' && (
                <div className="guided-card guided-scan-status" role="status" aria-live="polite">
                  <h3 className="guided-prompt">{t("Reading your receipt…")}</h3>
                  <div className="guided-progress-bar"><span style={{ width: `${Math.round(ocrProgress * 100)}%` }} /></div>
                  <p>{Math.round(ocrProgress * 100)}% {t('complete')}</p>
                </div>
              )}

              {!cameraFlow && ocrStatus !== 'scanning' && billItems.length > 0 && (
                    <div className="guided-card guided-receipt">
                      <div className="guided-list-heading"><h3 className="guided-prompt">{t("Items on this bill")}</h3><strong>{billItems.length}</strong></div>
                      <div className="guided-list" ref={billListRef}>
                        {billItems.map((item, index) => editingBillIndex === index ? (
                          <div className="guided-list-row guided-item-editor" ref={billEditorRef} key={`bill-item-${index}`}>
                            <label className="guided-field">{t("Item name")}<input autoFocus enterKeyHint="next" value={item.name} onChange={(event) => updateBillItem(index, 'name', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.closest('.guided-item-editor').querySelector('input[type="number"]')?.focus(); } }} placeholder={t("Item or expense")} /></label>
                            <label className="guided-field">{t("Line total")}<input type="number" min="0" step="0.01" inputMode="decimal" enterKeyHint="next" value={item.amount} onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => updateBillItem(index, 'amount', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.closest('.guided-item-editor').querySelectorAll('input[type="number"]')[1]?.focus(); } }} /></label>
                            <label className="guided-field">{t("Quantity")}<input type="number" min="1" inputMode="numeric" enterKeyHint="done" value={item.quantity} onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => updateBillItem(index, 'quantity', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); finishEditing(); } }} /></label>
                            <div className="guided-inline-actions"><BitsButton type="button" className="guided-secondary" onClick={() => removeBillItem(index)}>{t("Delete")}</BitsButton><BitsButton type="button" className="guided-action" onClick={finishEditing}>{t("Done")}</BitsButton></div>
                          </div>
                        ) : (
                          <div className="guided-list-row" key={`bill-item-${index}`}>
                            <div><strong>{item.name || t("Unnamed item")}</strong><small>{t('Qty')} {Number(item.quantity) || 1}</small></div>
                            <b>฿{(Number(item.amount) || 0).toFixed(2)}</b>
                            <BitsButton type="button" className="guided-row-button" onClick={() => setEditingBillIndex(index)} aria-label={t('Edit {name}', { name: item.name || t('item') })}>{t("Edit")}</BitsButton>
                            <BitsButton type="button" className="guided-row-button" onClick={() => removeBillItem(index)} aria-label={t('Delete {name}', { name: item.name || t('item') })}>×</BitsButton>
                          </div>
                        ))}
                      </div>
                    </div>
              )}
              {!cameraFlow && ocrStatus !== 'scanning' && !hasItems && !billImageUrl && (
                <div className="guided-card guided-empty-receipt">
                  <Doodle kind="plate" className="guided-empty-doodle" />
                  <span className="guided-kicker">{t("Your bill")}</span>
                  <h3 className="guided-prompt">{t("Every item has its place.")}</h3>
                  <p className="guided-note">{t("Add your first item or choose a receipt photo. Items will appear here as you go.")}</p>
                </div>
              )}
                </div>

                <div className="guided-side">
                  {!cameraFlow && ocrStatus !== 'scanning' && billItems.length === 0 && !manualComposerOpen && (
                    <div className="guided-side-panel">
                      <h3 className="guided-prompt">{t("Choose a way to start.")}</h3>
                      <div className="guided-options">
                        <BitsButton type="button" className="guided-option" disabled={cooldownRemaining > 0} onClick={startCameraFlow}><span aria-hidden="true">◎</span><strong>{t("Take a photo")}</strong><small>{t("Use your camera")}</small></BitsButton>
                        <BitsButton type="button" className="guided-option" disabled={cooldownRemaining > 0} onClick={() => uploadInputRef.current?.click()}><span aria-hidden="true">↑</span><strong>{t("Upload a receipt")}</strong><small>{t("Choose a photo")}</small></BitsButton>
                        <BitsButton type="button" className="guided-option" onClick={() => { setShowBillExtras(false); setManualComposerOpen(true); window.requestAnimationFrame(() => manualNameRef.current?.focus()); }}><span aria-hidden="true">＋</span><strong>{t("Type it in")}</strong><small>{t("Add items one by one")}</small></BitsButton>
                      </div>
                      {cooldownRemaining > 0 && <p className="guided-note">{t('You can scan another photo in {seconds}s, or type items now.', { seconds: cooldownRemaining })}</p>}
                    </div>
                  )}

                  {!cameraFlow && ocrStatus !== 'scanning' && (billItems.length > 0 || manualComposerOpen) && (
                    <>
                      <div className="guided-side-panel guided-bill-controls">
                        {hasItems && (
                          <div className="guided-side-tabs" aria-label={t("Bill controls")}>
                            <BitsButton type="button" className={`guided-side-tab${!showBillExtras ? ' is-active' : ''}`} aria-pressed={!showBillExtras} onClick={() => { setShowBillExtras(false); setManualComposerOpen(true); window.requestAnimationFrame(() => manualNameRef.current?.focus()); }}>{t("Add item")}</BitsButton>
                            <BitsButton type="button" className={`guided-side-tab${showBillExtras ? ' is-active' : ''}`} aria-pressed={showBillExtras} onClick={() => setShowBillExtras(true)}>{t("Bill options")}</BitsButton>
                          </div>
                        )}
                        {!showBillExtras || !hasItems ? (
                          manualComposerOpen ? (
                            <div className="guided-bill-entry">
                              <h3 className="guided-prompt">{hasItems ? t("Add another item.") : t("What is the first item?")}</h3>
                              <form id="guided-item-form" className="guided-composer guided-item-composer" onSubmit={addManualItemFromComposer}>
                                <label className="guided-field">{t("Item name")}<input ref={manualNameRef} type="text" value={manualItemName} onChange={(event) => setManualItemName(event.target.value)} onKeyDown={focusPrice} enterKeyHint="next" placeholder={t("e.g. Pizza")} maxLength={100} autoComplete="off" /></label>
                                <label className="guided-field">{t("Total price")}<input ref={priceInputRef} type="number" min="0" step="0.01" inputMode="decimal" enterKeyHint="done" value={manualItemPrice} onChange={(event) => setManualItemPrice(event.target.value)} placeholder="0.00" /></label>
                                <BitsButton type="submit" className="guided-action" disabled={!manualItemName.trim() || manualItemPrice === ''}>{t("Add item")}</BitsButton>
                              </form>
                              <div className="guided-entry-extras">
                                <div className="guided-entry-extra-actions">
                                  <BitsButton type="button" className="guided-reveal guided-inline-quantity-toggle" aria-expanded={showManualQuantity} onClick={toggleQuantity}>{showManualQuantity ? t("Hide quantity") : t("Add quantity")}</BitsButton>
                                  {!billItems.length && <BitsButton type="button" className="guided-reveal guided-photo-alternative" onClick={() => setManualComposerOpen(false)}>{t("Use a photo instead")}</BitsButton>}
                                </div>
                                {showManualQuantity && <label className="guided-field guided-quantity-field">{t("Quantity")}<input ref={quantityInputRef} form="guided-item-form" type="number" min="1" step="1" inputMode="numeric" enterKeyHint="done" value={manualQuantity} onChange={(event) => setManualQuantity(event.target.value)} /></label>}
                              </div>
                            </div>
                          ) : hasItems && (
                            <div className="guided-bill-entry">
                              <h3 className="guided-prompt">{t("Add another item?")}</h3>
                              <p className="guided-note">{t("Use the item name and full price. You can edit it in the list afterward.")}</p>
                              <BitsButton type="button" className="guided-action" onClick={() => { setManualComposerOpen(true); window.requestAnimationFrame(() => manualNameRef.current?.focus()); }}>{t("Add an item")}</BitsButton>
                            </div>
                          )
                        ) : (
                          <div className="guided-bill-options">
                          <h3 className="guided-prompt">{t("Bill options")}</h3>
                          <p className="guided-note">{t("Add tax or a discount if the bill needs it.")}</p>
                          <div className="guided-adjustments">
                            <label className="guided-check"><input type="checkbox" checked={vatEnabled} onChange={(event) => setVatEnabled(event.target.checked)} />{t("Add VAT")}</label>
                            {vatEnabled && <label className="guided-field">{t("VAT percentage")}<input type="number" min="0" max="100" step="0.01" inputMode="decimal" enterKeyHint="done" value={vatRate} onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => setVatRate(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); dismissKeyboard(); } }} /></label>}
                            <label className="guided-check"><input type="checkbox" checked={discountEnabled} onChange={(event) => setDiscountEnabled(event.target.checked)} />{t("Add discount")}</label>
                            {discountEnabled && <label className="guided-field">{t("Discount in baht")}<input type="number" min="0" step="0.01" inputMode="decimal" enterKeyHint="done" value={discountAmount} onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => setDiscountAmount(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); dismissKeyboard(); } }} /></label>}
                          </div>
                          {hasPendingItem && <p className="guided-note">{t("Your current item is still waiting in Add item.")}</p>}
                          </div>
                        )}
                      </div>
                      {hasItems && (
                        <div className="guided-side-panel guided-bill-end">
                          <div className="guided-total"><span>{t("Total")}</span><strong>฿{total.toFixed(2)}</strong></div>
                          {(vatEnabled || discountEnabled) && <p className="guided-note">{t('Subtotal')} ฿{subtotal.toFixed(2)}{vatEnabled ? ` · ${t('VAT')} ฿${vatAmount.toFixed(2)}` : ''}{discountEnabled ? ` · ${t('Discount')} −฿${appliedDiscount.toFixed(2)}` : ''}</p>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {step === 'split' && currentItem && (
            <div className="guided-workspace guided-workspace-sharing">
              <div className="guided-main"><div className="guided-card guided-share-item"><span className="guided-kicker">{t("Now sharing")}</span><h3>{currentItem.name}</h3><div><span>{t('Qty')} {Number(currentItem.quantity) || 1}</span><strong>฿{(Number(currentItem.amount) || 0).toFixed(2)}</strong></div></div></div>
              <div className="guided-side"><div className="guided-side-panel">
                <div className="guided-list-heading"><h3 className="guided-prompt">{t("Who had this?")}</h3><BitsButton type="button" className="guided-reveal" onClick={toggleAllFriendsForItem}>{selectedFriends.length === friends.length ? t("Clear all") : t("Select all")}</BitsButton></div>
                <div className="guided-split-options">
                  {friends.map((friend) => {
                    const selected = selectedFriends.includes(friend);
                    return <BitsButton type="button" key={friend} className={`guided-split-option${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={() => toggleFriendForItem(friend)}><span aria-hidden="true">{selected ? '✓' : '+'}</span><strong>{friend}</strong>{selected && <small>฿{itemShare(currentItem.amount, selectedFriends.length, selectedFriends.indexOf(friend)).toFixed(2)}</small>}</BitsButton>;
                  })}
                </div>
                <p className="guided-note">{selectedFriends.length ? t('{count} selected · Any extra satang goes to the first selected people.', { count: selectedFriends.length }) : t("Select at least one person to continue.")}</p>
              </div></div>
            </div>
          )}

          {step === 'result' && (
            <div className="guided-workspace guided-workspace-summary">
              <div className="guided-main"><div className="guided-card guided-summary"><span className="guided-kicker">{t("Bill complete")}</span><h3>{eventName}</h3><div className="guided-total"><span>{t("Total shared")}</span><strong>฿{total.toFixed(2)}</strong></div></div></div>
              <div className="guided-side"><div className="guided-side-panel"><h3 className="guided-prompt">{t("Each person owes")}</h3><div className="guided-result-list">{settlements.map((settlement, index) => <div className="guided-list-row" key={settlement.name}><span className="guided-number">{index + 1}</span><strong>{settlement.name}</strong><b>฿{settlement.amount.toFixed(2)}</b></div>)}</div></div></div>
            </div>
          )}

          {error && !cameraFlow && <p className="guided-error guided-desktop-error" role="alert">{error}</p>}
        </div>

        <footer className={`guided-footer${showMobileItemAction && !hasItems ? ' has-mobile-only-action' : ''}`}>
          {error && !cameraFlow && <p className="guided-error guided-mobile-error" role="alert">{error}</p>}
          {step === 'bill' && hasItems && ocrStatus !== 'scanning' && !cameraFlow && <div className="guided-footer-total"><span>{billItems.length} {billItems.length === 1 ? t('item') : t('items')}</span><strong>{t('Total')} ฿{total.toFixed(2)}</strong></div>}
          <div>
          {step === 'friends' && (!peopleNameConfirmed ? (
            <BitsButton type="submit" form="guided-bill-name" className="guided-action" disabled={!eventName.trim()}>{t("Next: add people")} <span aria-hidden="true">→</span></BitsButton>
          ) : (
            <BitsButton type="button" className="guided-action" disabled={friends.length < 2 || !eventName.trim()} onClick={continueToBill}>{friends.length < 2 ? t('Add {count} more', { count: 2 - friends.length }) : t("Continue to bill")} <span aria-hidden="true">→</span></BitsButton>
          ))}
          {showMobileItemAction && <><BitsButton type="button" className="guided-secondary guided-mobile-quantity-toggle" aria-expanded={showManualQuantity} onClick={toggleQuantity}>{showManualQuantity ? t("Hide quantity") : t("Add quantity")}</BitsButton><BitsButton type="submit" form="guided-item-form" className="guided-action guided-mobile-item-submit" disabled={!manualItemName.trim() || manualItemPrice === ''}>{t("Add item")} <span aria-hidden="true">＋</span></BitsButton></>}
          {step === 'bill' && editingBillIndex !== null && <div className="guided-mobile-edit-actions"><BitsButton type="button" className="guided-secondary" onClick={() => { dismissKeyboard(); removeBillItem(editingBillIndex); }}>{t("Delete item")}</BitsButton><BitsButton type="button" className="guided-action" onClick={finishEditing}>{t("Done")}</BitsButton></div>}
          {step === 'bill' && billItems.length > 0 && ocrStatus !== 'scanning' && <BitsButton type="button" className="guided-action guided-continue-sharing" disabled={!hasItems || editingBillIndex !== null || hasPendingItem} onClick={startSplitting}>{hasPendingItem ? 'Add your current item first' : 'Continue to sharing'} <span aria-hidden="true">→</span></BitsButton>}
          {step === 'split' && <><BitsButton type="button" className="guided-secondary" disabled={splitIndex === 0 || isSaving} onClick={goToPreviousFood}>{t("Previous item")}</BitsButton><BitsButton type="button" className="guided-action" disabled={!selectedFriends.length || isSaving} onClick={goToNextFood}>{isSaving ? t("Calculating…") : splitIndex === billItems.length - 1 ? t("See the split") : t("Next item")} <span aria-hidden="true">→</span></BitsButton></>}
          {step === 'result' && <><BitsButton type="button" className="guided-secondary" onClick={() => downloadSummary()}>{t("Download picture")}</BitsButton>{!historySaved && <BitsButton type="button" className="guided-secondary" disabled={isSaving} onClick={finishSplitting}>{t("Retry saving")}</BitsButton>}<BitsButton type="button" className="guided-action" onClick={finishOperation}>{t("Done")} <span aria-hidden="true">✓</span></BitsButton></>}
        </div></footer>

        {step === 'bill' && cameraFlow && (
          <div className="mobile-camera-flow is-editor" role="dialog" aria-modal="true" aria-label={t("Crop bill photo")}>
            <BitsButton type="button" className="guided-crop-back" disabled={isCropping} onClick={closeCameraFlow}>{t("← Back to bill")}</BitsButton>
            <p className="camera-editor-copy"><strong>{t("Adjust your photo")}</strong><span>{t("Move the receipt into the frame, then confirm.")}</span></p>
            <div ref={cropWorkspaceRef} className="camera-crop-workspace" onPointerDown={beginCropDrag} onPointerMove={moveCropDrag} onPointerUp={endCropDrag} onPointerCancel={endCropDrag} onWheel={zoomCropWithWheel}>
              <BitsButton type="button" className="crop-aspect-toggle" aria-label={`Switch crop frame to ${cropAspect === '16:9' ? '9 by 16 portrait' : '16 by 9 landscape'}`} onPointerDown={(event) => event.stopPropagation()} onClick={toggleCropAspect}><span>{cropAspect}</span></BitsButton>
              {!cropBaseSize.width && <div className="camera-photo-skeleton" role="status" aria-label={t("Preparing photo")}><span /></div>}
              <img ref={cropImageRef} src={pendingCameraUrl} alt={t("Bill to crop")} draggable="false" onError={() => { closeCameraFlow(); flow.setError(t("This image could not be opened. Choose a supported photo or type the items instead.")); }} onLoad={() => window.requestAnimationFrame(initializeCropEditor)} style={{ width: `${cropBaseSize.width}px`, height: `${cropBaseSize.height}px`, transform: `translate(-50%, -50%) translate3d(${cropTransform.x}px, ${cropTransform.y}px, 0) rotate(${cropTransform.rotation}deg) scale(${cropTransform.zoom})` }} />
              <div ref={cropFrameRef} className={`camera-crop-frame${cropAspect === '9:16' ? ' is-portrait' : ''}`} aria-hidden="true" />
            </div>
            <div className="camera-confirm-actions"><BitsButton type="button" disabled={isCropping} onClick={() => (cameraFlow === 'upload' ? uploadInputRef : cameraInputRef).current?.click()}>{cameraFlow === 'upload' ? t("Choose again") : t("Retake")}</BitsButton><BitsButton type="button" className="camera-confirm-button" disabled={!cropBaseSize.width || isCropping} onClick={confirmCameraBill}>{isCropping ? t("Preparing…") : t("Confirm photo")}</BitsButton></div>
            {error && <p className="guided-error" role="alert">{error}</p>}
          </div>
        )}
      </BitsSurface>
    </div>
  );
}
