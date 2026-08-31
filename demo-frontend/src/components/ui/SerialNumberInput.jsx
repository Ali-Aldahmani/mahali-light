import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import Input from './Input.jsx';
import { lookupWarranties } from '../../services/warrantyService.js';

// A serial-number field for serialised products in the POS cart.
//   - debounces on-change validation
//   - on blur, checks the lookup endpoint for an existing ACTIVE warranty
//     covering the same serial; if found, marks the field as invalid so the
//     cashier can fix it before confirmation
//   - emits `onChange(value, { valid, error })`
export default function SerialNumberInput({
  value = '',
  onChange,
  productId,
  productName,
  required = false,
  disabled = false,
  className = '',
}) {
  const [localValue, setLocalValue] = useState(value || '');
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [verified, setVerified] = useState(false);
  const lastCheckedRef = useRef('');

  // Keep external -> local in sync without clobbering active typing.
  useEffect(() => {
    if (value !== localValue && document.activeElement !== inputRef.current) {
      setLocalValue(value || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const inputRef = useRef(null);

  function emit(nextValue, nextError) {
    if (typeof onChange === 'function') {
      onChange(nextValue, { valid: !nextError, error: nextError });
    }
  }

  async function validate(v) {
    if (!v) {
      setError(required ? 'Serial number required' : null);
      setVerified(false);
      emit(v, required ? 'Serial number required' : null);
      return;
    }
    if (lastCheckedRef.current === v) return;
    lastCheckedRef.current = v;
    setChecking(true);
    setVerified(false);
    try {
      const matches = await lookupWarranties(v);
      const conflict = (matches || []).find(
        (w) =>
          w.serialNumber === v &&
          w.status === 'active' &&
          (!productId || w.productId === productId),
      );
      if (conflict) {
        const msg = `Serial ${v} already covered by warranty ${conflict.warrantyNumber}.`;
        setError(msg);
        setVerified(false);
        emit(v, msg);
      } else {
        setError(null);
        setVerified(true);
        emit(v, null);
      }
    } catch (_e) {
      setError(null);
      setVerified(false);
      emit(v, null);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className={className}>
      <Input
        ref={inputRef}
        label={`Serial number${required ? '' : ' (optional)'}`}
        value={localValue}
        disabled={disabled}
        placeholder={productName ? `e.g. SN-${productName.slice(0, 4).toUpperCase()}-0001` : 'Serial / IMEI'}
        onChange={(e) => {
          const next = e.target.value.trim();
          setLocalValue(next);
          setError(null);
          setVerified(false);
          emit(next, null);
        }}
        onBlur={(e) => validate(e.target.value.trim())}
        rightIcon={
          checking ? (
            <span className="text-ink-muted text-xs">…</span>
          ) : verified ? (
            <Check className="h-4 w-4 text-success" />
          ) : error ? (
            <AlertCircle className="h-4 w-4 text-error" />
          ) : null
        }
        error={error || undefined}
        hint={!error && verified ? 'Serial available.' : undefined}
      />
    </div>
  );
}
