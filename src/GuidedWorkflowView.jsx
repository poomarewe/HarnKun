import React from 'react';
import DoodleField, { Doodle } from './DecorativeDoodles';

const stageNames = ['People', 'Bill', 'Sharing', 'Summary'];

export default function GuidedWorkflowView({ flow }) {
  const {
    BitsButton, BitsSurface, isWorkflowClosing, workflowDirection, step, splitIndex,
    eventName, friendName, friends, error, billItems, billImageUrl, ocrStatus,
    ocrProgress, cooldownRemaining, cameraFlow, pendingCameraUrl, cropAspect,
    cropBaseSize, cropTransform, isCropping, editingBillIndex, vatEnabled, vatRate,
    discountEnabled, discountAmount, subtotal, vatAmount, appliedDiscount, total,
    allocations, isSaving, settlements, peopleNameConfirmed, manualComposerOpen,
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
  const titles = {
    friends: peopleNameConfirmed ? 'Who is splitting?' : 'Give this bill a name.',
    bill: hasItems ? 'Your bill, made clear.' : 'How should we add the bill?',
    split: 'Share one item at a time.',
    result: 'All shared fairly.',
  };
  const descriptions = {
    friends: peopleNameConfirmed ? 'Add everyone who joined. You can remove a name before continuing.' : 'A short name makes this bill easy to find later.',
    bill: hasItems ? 'Review the items, then move on when everything looks right.' : 'Take a photo, upload one, or enter items yourself.',
    split: 'Tap everyone who shared this item. We will divide its price evenly.',
    result: 'Here is what each person owes. This bill is saved in Recent bills.',
  };

  return (
    <div className={`overlay${isWorkflowClosing ? ' is-closing' : ''}`} role="presentation" onMouseDown={closePanel}>
      <BitsSurface
        as="section"
        key={`${step}-${step === 'split' ? splitIndex : ''}`}
        className={`operation-panel guided-flow direction-${workflowDirection} step-${step}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${stageNames[stageIndex]} step`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="guided-header">
          <div className="guided-brand"><span aria-hidden="true">✳</span> Harn Kun</div>
          <div className="guided-header-actions">
            <BitsButton type="button" className="guided-back" onClick={guidedGoBack} disabled={isSaving || ocrStatus === 'scanning'} aria-label="Back">←</BitsButton>
            <BitsButton type="button" className="guided-close" onClick={closePanel} aria-label="Close">×</BitsButton>
          </div>
        </header>

        <DoodleField
          variant={step === 'friends' ? 'friends' : step === 'bill' ? 'bill' : step === 'split' ? 'sharing' : 'summary'}
          className="guided-doodle-field"
        />

        <div className="guided-body">
          <ol className="guided-stages" aria-label="Bill progress">
            {stageNames.map((name, index) => (
              <li className={`guided-stage${index < stageIndex ? ' is-complete' : ''}${index === stageIndex ? ' is-current' : ''}`} aria-current={index === stageIndex ? 'step' : undefined} key={name}>
                <span aria-hidden="true">{index < stageIndex ? '✓' : index + 1}</span>{name}
              </li>
            ))}
          </ol>
          <section className="guided-intro">
            <span className="guided-kicker">{step === 'split' ? `Item ${splitIndex + 1} of ${billItems.length}` : `Step ${stageIndex + 1} of 4`}</span>
            <h2 className="guided-title">{titles[step]}</h2>
            <p className="guided-description">{descriptions[step]}</p>
          </section>

          {(step !== 'friends' || peopleNameConfirmed) && (
            <ul className="guided-trail" aria-label="Completed details">
              {eventName.trim() && <li className="guided-trail-item">{eventName}</li>}
              {step !== 'friends' && <li className="guided-trail-item">{friends.length} people</li>}
              {(step === 'split' || step === 'result') && <li className="guided-trail-item">{billItems.length} items · ฿{total.toFixed(2)}</li>}
            </ul>
          )}

          {step === 'friends' && !peopleNameConfirmed && (
            <div className="guided-card">
              <h3 className="guided-prompt">What was the occasion?</h3>
              <label className="guided-field" htmlFor="bill-event-name">Bill name
                <input id="bill-event-name" type="text" value={eventName} onChange={(event) => setEventName(event.target.value)} maxLength={80} placeholder="e.g. Friday dinner" autoComplete="off" autoFocus />
              </label>
            </div>
          )}

          {step === 'friends' && peopleNameConfirmed && (
            <div className="guided-card">
              <h3 className="guided-prompt">Add your people.</h3>
              <form className="guided-composer guided-people-composer" onSubmit={addFriend} autoComplete="off" data-form-type="other">
                <label className="guided-field" htmlFor="friend-name">Name
                  <input ref={inputRef} id="friend-name" name="friend-name-entry" type="text" value={friendName} onChange={(event) => setFriendName(event.target.value)} placeholder="Type a name" maxLength={60} disabled={friends.length >= 100} enterKeyHint="done" autoComplete="off" data-lpignore="true" />
                </label>
                <BitsButton type="submit" className="guided-action" disabled={!friendName.trim() || friends.length >= 100}>Add person</BitsButton>
              </form>
              <div className="guided-list-heading"><strong>{friends.length} people added</strong><span>At least 2 needed</span></div>
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
                  <BitsButton type="button" className="guided-photo-thumb" onClick={() => setBillPhotoOpen(true)} aria-label="View receipt photo"><img src={billImageUrl} alt="Selected receipt" /></BitsButton>
                  <div><strong>{ocrStatus === 'scanning' ? 'Reading your receipt…' : 'Receipt photo'}</strong><small>Tap to view</small></div>
                  {ocrStatus !== 'scanning' && <BitsButton type="button" className="guided-secondary" disabled={cooldownRemaining > 0} onClick={() => uploadInputRef.current?.click()}>{cooldownRemaining > 0 ? `${cooldownRemaining}s` : 'Change'}</BitsButton>}
                </div>
              )}

              {!cameraFlow && ocrStatus === 'scanning' && (
                <div className="guided-card guided-scan-status" role="status" aria-live="polite">
                  <h3 className="guided-prompt">Reading your receipt…</h3>
                  <div className="guided-progress-bar"><span style={{ width: `${Math.round(ocrProgress * 100)}%` }} /></div>
                  <p>{Math.round(ocrProgress * 100)}% complete</p>
                </div>
              )}

              {!cameraFlow && ocrStatus !== 'scanning' && billItems.length > 0 && (
                    <div className="guided-card guided-receipt">
                      <div className="guided-list-heading"><h3 className="guided-prompt">Items on this bill</h3><strong>{billItems.length}</strong></div>
                      <div className="guided-list" ref={billListRef}>
                        {billItems.map((item, index) => editingBillIndex === index ? (
                          <div className="guided-list-row guided-item-editor" ref={billEditorRef} key={`bill-item-${index}`}>
                            <label className="guided-field">Item name<input autoFocus value={item.name} onChange={(event) => updateBillItem(index, 'name', event.target.value)} placeholder="Item or expense" /></label>
                            <label className="guided-field">Line total<input type="number" min="0" step="0.01" inputMode="decimal" value={item.amount} onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => updateBillItem(index, 'amount', event.target.value)} /></label>
                            <label className="guided-field">Quantity<input type="number" min="1" inputMode="numeric" value={item.quantity} onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => updateBillItem(index, 'quantity', event.target.value)} /></label>
                            <div className="guided-inline-actions"><BitsButton type="button" className="guided-secondary" onClick={() => removeBillItem(index)}>Delete</BitsButton><BitsButton type="button" className="guided-action" onClick={() => setEditingBillIndex(null)}>Done</BitsButton></div>
                          </div>
                        ) : (
                          <div className="guided-list-row" key={`bill-item-${index}`}>
                            <div><strong>{item.name || 'Unnamed item'}</strong><small>Qty {Number(item.quantity) || 1}</small></div>
                            <b>฿{(Number(item.amount) || 0).toFixed(2)}</b>
                            <BitsButton type="button" className="guided-row-button" onClick={() => setEditingBillIndex(index)} aria-label={`Edit ${item.name || 'item'}`}>Edit</BitsButton>
                            <BitsButton type="button" className="guided-row-button" onClick={() => removeBillItem(index)} aria-label={`Delete ${item.name || 'item'}`}>×</BitsButton>
                          </div>
                        ))}
                      </div>
                    </div>
              )}
              {!cameraFlow && ocrStatus !== 'scanning' && !hasItems && !billImageUrl && (
                <div className="guided-card guided-empty-receipt">
                  <Doodle kind="plate" className="guided-empty-doodle" />
                  <span className="guided-kicker">Your bill</span>
                  <h3 className="guided-prompt">Every item has its place.</h3>
                  <p className="guided-note">Add your first item or choose a receipt photo. Items will appear here as you go.</p>
                </div>
              )}
                </div>

                <div className="guided-side">
                  {!cameraFlow && ocrStatus !== 'scanning' && billItems.length === 0 && !manualComposerOpen && (
                    <div className="guided-side-panel">
                      <h3 className="guided-prompt">Choose a way to start.</h3>
                      <div className="guided-options">
                        <BitsButton type="button" className="guided-option" disabled={cooldownRemaining > 0} onClick={startCameraFlow}><span aria-hidden="true">◎</span><strong>Take a photo</strong><small>Use your camera</small></BitsButton>
                        <BitsButton type="button" className="guided-option" disabled={cooldownRemaining > 0} onClick={() => uploadInputRef.current?.click()}><span aria-hidden="true">↑</span><strong>Upload a receipt</strong><small>Choose a photo</small></BitsButton>
                        <BitsButton type="button" className="guided-option" onClick={() => { setShowBillExtras(false); setManualComposerOpen(true); window.requestAnimationFrame(() => manualNameRef.current?.focus()); }}><span aria-hidden="true">＋</span><strong>Type it in</strong><small>Add items one by one</small></BitsButton>
                      </div>
                      {cooldownRemaining > 0 && <p className="guided-note">You can scan another photo in {cooldownRemaining}s, or type items now.</p>}
                    </div>
                  )}

                  {!cameraFlow && ocrStatus !== 'scanning' && (billItems.length > 0 || manualComposerOpen) && (
                    <>
                      <div className="guided-side-panel guided-bill-controls">
                        {hasItems && (
                          <div className="guided-side-tabs" aria-label="Bill controls">
                            <BitsButton type="button" className={`guided-side-tab${!showBillExtras ? ' is-active' : ''}`} aria-pressed={!showBillExtras} onClick={() => { setShowBillExtras(false); setManualComposerOpen(true); window.requestAnimationFrame(() => manualNameRef.current?.focus()); }}>Add item</BitsButton>
                            <BitsButton type="button" className={`guided-side-tab${showBillExtras ? ' is-active' : ''}`} aria-pressed={showBillExtras} onClick={() => setShowBillExtras(true)}>Bill options</BitsButton>
                          </div>
                        )}
                        {!showBillExtras || !hasItems ? (
                          manualComposerOpen ? (
                            <div className="guided-bill-entry">
                              <h3 className="guided-prompt">{hasItems ? 'Add another item.' : 'What is the first item?'}</h3>
                              <form className="guided-composer guided-item-composer" onSubmit={addManualItemFromComposer}>
                                <label className="guided-field">Item name<input ref={manualNameRef} type="text" value={manualItemName} onChange={(event) => setManualItemName(event.target.value)} placeholder="e.g. Pizza" maxLength={100} autoComplete="off" /></label>
                                <label className="guided-field">Total price<input type="number" min="0" step="0.01" inputMode="decimal" value={manualItemPrice} onChange={(event) => setManualItemPrice(event.target.value)} placeholder="0.00" /></label>
                                <BitsButton type="submit" className="guided-action" disabled={!manualItemName.trim() || manualItemPrice === ''}>Add item</BitsButton>
                              </form>
                              <div className="guided-entry-extras">
                                <div className="guided-entry-extra-actions">
                                  <BitsButton type="button" className="guided-reveal" aria-expanded={showManualQuantity} onClick={() => setShowManualQuantity((open) => !open)}>{showManualQuantity ? 'Hide quantity' : 'Add quantity'}</BitsButton>
                                  {!billItems.length && <BitsButton type="button" className="guided-reveal" onClick={() => setManualComposerOpen(false)}>Use a photo instead</BitsButton>}
                                </div>
                                {showManualQuantity && <label className="guided-field guided-quantity-field">Quantity<input type="number" min="1" inputMode="numeric" value={manualQuantity} onChange={(event) => setManualQuantity(event.target.value)} /></label>}
                              </div>
                            </div>
                          ) : hasItems && (
                            <div className="guided-bill-entry">
                              <h3 className="guided-prompt">Add another item?</h3>
                              <p className="guided-note">Use the item name and full price. You can edit it in the list afterward.</p>
                              <BitsButton type="button" className="guided-action" onClick={() => { setManualComposerOpen(true); window.requestAnimationFrame(() => manualNameRef.current?.focus()); }}>Add an item</BitsButton>
                            </div>
                          )
                        ) : (
                          <div className="guided-bill-options">
                          <h3 className="guided-prompt">Bill options</h3>
                          <p className="guided-note">Add tax or a discount if the bill needs it.</p>
                          <div className="guided-adjustments">
                            <label className="guided-check"><input type="checkbox" checked={vatEnabled} onChange={(event) => setVatEnabled(event.target.checked)} />Add VAT</label>
                            {vatEnabled && <label className="guided-field">VAT percentage<input type="number" min="0" max="100" step="0.01" inputMode="decimal" value={vatRate} onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => setVatRate(event.target.value)} /></label>}
                            <label className="guided-check"><input type="checkbox" checked={discountEnabled} onChange={(event) => setDiscountEnabled(event.target.checked)} />Add discount</label>
                            {discountEnabled && <label className="guided-field">Discount in baht<input type="number" min="0" step="0.01" inputMode="decimal" value={discountAmount} onFocus={selectWholeValue} onClick={selectWholeValue} onChange={(event) => setDiscountAmount(event.target.value)} /></label>}
                          </div>
                          {hasPendingItem && <p className="guided-note">Your current item is still waiting in Add item.</p>}
                          </div>
                        )}
                      </div>
                      {hasItems && (
                        <div className="guided-side-panel guided-bill-end">
                          <div className="guided-total"><span>Total</span><strong>฿{total.toFixed(2)}</strong></div>
                          {(vatEnabled || discountEnabled) && <p className="guided-note">Subtotal ฿{subtotal.toFixed(2)}{vatEnabled ? ` · VAT ฿${vatAmount.toFixed(2)}` : ''}{discountEnabled ? ` · Discount −฿${appliedDiscount.toFixed(2)}` : ''}</p>}
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
              <div className="guided-main"><div className="guided-card guided-share-item"><span className="guided-kicker">Now sharing</span><h3>{currentItem.name}</h3><div><span>Qty {Number(currentItem.quantity) || 1}</span><strong>฿{(Number(currentItem.amount) || 0).toFixed(2)}</strong></div></div></div>
              <div className="guided-side"><div className="guided-side-panel">
                <div className="guided-list-heading"><h3 className="guided-prompt">Who had this?</h3><BitsButton type="button" className="guided-reveal" onClick={toggleAllFriendsForItem}>{selectedFriends.length === friends.length ? 'Clear all' : 'Select all'}</BitsButton></div>
                <div className="guided-split-options">
                  {friends.map((friend) => {
                    const selected = selectedFriends.includes(friend);
                    return <BitsButton type="button" key={friend} className={`guided-split-option${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={() => toggleFriendForItem(friend)}><span aria-hidden="true">{selected ? '✓' : '+'}</span><strong>{friend}</strong>{selected && <small>฿{((Number(currentItem.amount) || 0) / selectedFriends.length).toFixed(2)}</small>}</BitsButton>;
                  })}
                </div>
                <p className="guided-note">{selectedFriends.length ? `${selectedFriends.length} selected · ฿${((Number(currentItem.amount) || 0) / selectedFriends.length).toFixed(2)} each` : 'Select at least one person to continue.'}</p>
              </div></div>
            </div>
          )}

          {step === 'result' && (
            <div className="guided-workspace guided-workspace-summary">
              <div className="guided-main"><div className="guided-card guided-summary"><span className="guided-kicker">Bill complete</span><h3>{eventName}</h3><div className="guided-total"><span>Total shared</span><strong>฿{total.toFixed(2)}</strong></div></div></div>
              <div className="guided-side"><div className="guided-side-panel"><h3 className="guided-prompt">Each person owes</h3><div className="guided-result-list">{settlements.map((settlement, index) => <div className="guided-list-row" key={settlement.name}><span className="guided-number">{index + 1}</span><strong>{settlement.name}</strong><b>฿{settlement.amount.toFixed(2)}</b></div>)}</div></div></div>
            </div>
          )}

          {error && !cameraFlow && <p className="guided-error" role="alert">{error}</p>}
        </div>

        <footer className="guided-footer"><div>
          {step === 'friends' && (!peopleNameConfirmed ? (
            <BitsButton type="button" className="guided-action" disabled={!eventName.trim()} onClick={() => setPeopleNameConfirmed(true)}>Next: add people <span aria-hidden="true">→</span></BitsButton>
          ) : (
            <BitsButton type="button" className="guided-action" disabled={friends.length < 2 || !eventName.trim()} onClick={continueToBill}>{friends.length < 2 ? `Add ${2 - friends.length} more` : 'Continue to bill'} <span aria-hidden="true">→</span></BitsButton>
          ))}
          {step === 'bill' && billItems.length > 0 && ocrStatus !== 'scanning' && <BitsButton type="button" className="guided-action" disabled={!hasItems || editingBillIndex !== null || hasPendingItem} onClick={startSplitting}>{hasPendingItem ? 'Add your current item first' : 'Continue to sharing'} <span aria-hidden="true">→</span></BitsButton>}
          {step === 'split' && <><BitsButton type="button" className="guided-secondary" disabled={splitIndex === 0 || isSaving} onClick={goToPreviousFood}>Previous item</BitsButton><BitsButton type="button" className="guided-action" disabled={!selectedFriends.length || isSaving} onClick={goToNextFood}>{isSaving ? 'Calculating…' : splitIndex === billItems.length - 1 ? 'See the split' : 'Next item'} <span aria-hidden="true">→</span></BitsButton></>}
          {step === 'result' && <><BitsButton type="button" className="guided-secondary" onClick={() => downloadSummary()}>Download picture</BitsButton><BitsButton type="button" className="guided-action" onClick={finishOperation}>Done <span aria-hidden="true">✓</span></BitsButton></>}
        </div></footer>

        {step === 'bill' && cameraFlow && (
          <div className="mobile-camera-flow is-editor" role="dialog" aria-modal="true" aria-label="Crop bill photo">
            <BitsButton type="button" className="guided-crop-back" disabled={isCropping} onClick={closeCameraFlow}>← Back to bill</BitsButton>
            <p className="camera-editor-copy"><strong>Adjust your photo</strong><span>Move the receipt into the frame, then confirm.</span></p>
            <div ref={cropWorkspaceRef} className="camera-crop-workspace" onPointerDown={beginCropDrag} onPointerMove={moveCropDrag} onPointerUp={endCropDrag} onPointerCancel={endCropDrag} onWheel={zoomCropWithWheel}>
              <BitsButton type="button" className="crop-aspect-toggle" aria-label={`Switch crop frame to ${cropAspect === '16:9' ? '9 by 16 portrait' : '16 by 9 landscape'}`} onPointerDown={(event) => event.stopPropagation()} onClick={toggleCropAspect}><span>{cropAspect}</span></BitsButton>
              {!cropBaseSize.width && <div className="camera-photo-skeleton" role="status" aria-label="Preparing photo"><span /></div>}
              <img ref={cropImageRef} src={pendingCameraUrl} alt="Bill to crop" draggable="false" onLoad={() => window.requestAnimationFrame(initializeCropEditor)} style={{ width: `${cropBaseSize.width}px`, height: `${cropBaseSize.height}px`, transform: `translate(-50%, -50%) translate3d(${cropTransform.x}px, ${cropTransform.y}px, 0) rotate(${cropTransform.rotation}deg) scale(${cropTransform.zoom})` }} />
              <div ref={cropFrameRef} className={`camera-crop-frame${cropAspect === '9:16' ? ' is-portrait' : ''}`} aria-hidden="true" />
            </div>
            <div className="camera-confirm-actions"><BitsButton type="button" disabled={isCropping} onClick={() => (cameraFlow === 'upload' ? uploadInputRef : cameraInputRef).current?.click()}>{cameraFlow === 'upload' ? 'Choose again' : 'Retake'}</BitsButton><BitsButton type="button" className="camera-confirm-button" disabled={!cropBaseSize.width || isCropping} onClick={confirmCameraBill}>{isCropping ? 'Preparing…' : 'Confirm photo'}</BitsButton></div>
            {error && <p className="guided-error" role="alert">{error}</p>}
          </div>
        )}
      </BitsSurface>
    </div>
  );
}
