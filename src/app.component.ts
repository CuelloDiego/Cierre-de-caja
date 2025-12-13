import { Component, ChangeDetectionStrategy, signal, computed, WritableSignal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from './environments/environment';

// --- Interfaces for data structures ---
interface CashEntry {
  denomination: number | null;
  quantity: number | null;
}

interface ExpenseEntry {
  detail: string;
  amount: number | null;
}

interface LogEntry {
  day: string;
  closerName: string;
  shift: 'mañana' | 'tarde';
  accountingImputation: string;
  accountEntry: string;
  amount: number;
}

const DEFAULT_CASH_ENTRIES: CashEntry[] = [
  { denomination: 20000, quantity: null },
  { denomination: 10000, quantity: null },
  { denomination: 2000, quantity: null },
];

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule]
})
export class AppComponent {
  // --- Injected Services ---
  private http: HttpClient = inject(HttpClient);
  private webhookUrl = environment.webhookUrl;
  
  // --- Form state signals ---
  closerName = signal('');
  shift = signal<'mañana' | 'tarde'>('mañana');
  firstDataIncome = signal<number | null>(null);
  pedidosYaIncome = signal<number | null>(null);
  mercadoPagoIncome = signal<number | null>(null);
  dailySummary = signal<number | null>(null);

  cashEntries: WritableSignal<CashEntry[]> = signal(structuredClone(DEFAULT_CASH_ENTRIES));
  expenses: WritableSignal<ExpenseEntry[]> = signal([{ detail: '', amount: null }]);

  // --- Webhook Status ---
  webhookStatus = signal<'idle' | 'sending' | 'success' | 'error'>('idle');
  webhookError = signal<string | null>(null);

  // --- History Log ---
  logHistory: WritableSignal<LogEntry[]> = signal([]);

  // --- Computed signals for automatic calculations ---
  cashSubtotal = computed(() => {
    return this.cashEntries().reduce((acc, entry) => {
      const denomination = entry.denomination ?? 0;
      const quantity = entry.quantity ?? 0;
      return acc + (denomination * quantity);
    }, 0);
  });

  expensesSubtotal = computed(() => {
    return this.expenses().reduce((acc, expense) => {
      const amount = expense.amount ?? 0;
      return acc + amount;
    }, 0);
  });

  digitalIncomeSubtotal = computed(() => {
    const firstData = this.firstDataIncome() ?? 0;
    const pedidosYa = this.pedidosYaIncome() ?? 0;
    const mercadoPago = this.mercadoPagoIncome() ?? 0;
    return firstData + pedidosYa + mercadoPago;
  });

  totalIncome = computed(() => {
    return this.digitalIncomeSubtotal() + this.cashSubtotal();
  });
  
  netTotal = computed(() => this.totalIncome() - this.expensesSubtotal());

  absoluteTotal = computed(() => {
    return this.totalIncome() + this.expensesSubtotal();
  });

  difference = computed(() => this.absoluteTotal() - (this.dailySummary() ?? 0));

  // --- Real-time Input Handlers ---
  private getNumberValue(event: Event): number | null {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    return isNaN(value) ? null : value;
  }

  private getStringValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  onNameKeyup(event: Event) { this.closerName.set(this.getStringValue(event)); }
  onShiftChange(event: Event) { this.shift.set((event.target as HTMLSelectElement).value as 'mañana' | 'tarde'); }
  onFirstDataKeyup(event: Event) { this.firstDataIncome.set(this.getNumberValue(event)); }
  onPedidosYaKeyup(event: Event) { this.pedidosYaIncome.set(this.getNumberValue(event)); }
  onMercadoPagoKeyup(event: Event) { this.mercadoPagoIncome.set(this.getNumberValue(event)); }
  onDailySummaryKeyup(event: Event) { this.dailySummary.set(this.getNumberValue(event)); }

  onCashEntryKeyup(index: number, field: 'denomination' | 'quantity', event: Event) {
    const value = this.getNumberValue(event);
    this.cashEntries.update(entries => {
      const newEntries = [...entries];
      newEntries[index] = { ...newEntries[index], [field]: value };
      return newEntries;
    });
  }

  onExpenseDetailKeyup(index: number, event: Event) {
    const value = this.getStringValue(event);
    this.expenses.update(entries => {
      const newEntries = [...entries];
      newEntries[index] = { ...newEntries[index], detail: value };
      return newEntries;
    });
  }

  onExpenseAmountKeyup(index: number, event: Event) {
    const value = this.getNumberValue(event);
    this.expenses.update(entries => {
      const newEntries = [...entries];
      newEntries[index] = { ...newEntries[index], amount: value };
      return newEntries;
    });
  }

  // --- Methods for managing dynamic form arrays ---
  addCashEntry() {
    this.cashEntries.update(entries => [...entries, { denomination: null, quantity: null }]);
  }

  removeCashEntry(index: number) {
    this.cashEntries.update(entries => entries.filter((_, i) => i !== index));
  }

  addExpense() {
    this.expenses.update(entries => [...entries, { detail: '', amount: null }]);
  }

  removeExpense(index: number) {
    this.expenses.update(entries => entries.filter((_, i) => i !== index));
  }
  
  // --- Form Submission Logic ---
  submitForm() {
    this.webhookStatus.set('sending');
    this.webhookError.set(null);

    if (!this.closerName() || !this.shift()) {
      this.webhookStatus.set('error');
      this.webhookError.set('Por favor, complete su nombre y el turno antes de enviar.');
      return;
    }

    const newLogEntries: LogEntry[] = [];
    const now = new Date().toISOString();
    const closerName = this.closerName();
    const shift = this.shift();

    // Add income entries
    if ((this.firstDataIncome() ?? 0) > 0) {
      newLogEntries.push({ day: now, closerName, shift, accountingImputation: 'Ventas con Tarjeta', accountEntry: 'Ingreso: First Data', amount: this.firstDataIncome()! });
    }
    if ((this.pedidosYaIncome() ?? 0) > 0) {
      newLogEntries.push({ day: now, closerName, shift, accountingImputation: 'Ventas Delivery', accountEntry: 'Ingreso: PedidosYa', amount: this.pedidosYaIncome()! });
    }
    if ((this.mercadoPagoIncome() ?? 0) > 0) {
      newLogEntries.push({ day: now, closerName, shift, accountingImputation: 'Ventas Digitales', accountEntry: 'Ingreso: Mercado Pago', amount: this.mercadoPagoIncome()! });
    }
    if (this.cashSubtotal() > 0) {
        newLogEntries.push({ day: now, closerName, shift, accountingImputation: 'Ventas en Efectivo', accountEntry: 'Ingreso: Efectivo', amount: this.cashSubtotal() });
    }
    
    // Add expense entries
    this.expenses().forEach(expense => {
      if (expense.amount && expense.amount > 0 && expense.detail) {
        newLogEntries.push({ day: now, closerName, shift, accountingImputation: 'Gastos Operativos', accountEntry: `Gasto: ${expense.detail}`, amount: -expense.amount });
      }
    });

    // Add summary and difference entries
    if (this.dailySummary() !== null) {
      newLogEntries.push({ day: now, closerName, shift, accountingImputation: 'Cierre', accountEntry: 'Resumen Diario (Manual)', amount: this.dailySummary()! });
      newLogEntries.push({ day: now, closerName, shift, accountingImputation: 'Cierre', accountEntry: 'Diferencia de Caja', amount: this.difference() });
    }

    if(newLogEntries.length === 0) {
        this.webhookStatus.set('error');
        this.webhookError.set('No hay movimientos para registrar.');
        return;
    }

    this.http.post(this.webhookUrl, newLogEntries).subscribe({
      next: (response) => {
        console.log('Webhook success:', response);
        this.webhookStatus.set('success');
        this.logHistory.update(currentLog => [...newLogEntries, ...currentLog]);
        this.resetForm();
        setTimeout(() => this.webhookStatus.set('idle'), 5000); // Hide after 5s
      },
      error: (err) => {
        console.error('Webhook error:', err);
        this.webhookStatus.set('error');
        let message = 'Error al enviar. Intente de nuevo.';
        if (err.status === 0) {
            message = 'Error de red/CORS. Verifique la conexión.';
        } else {
            message = `Error del servidor: ${err.status}.`;
        }
        this.webhookError.set(message);
      }
    });
  }

  resetForm() {
    this.closerName.set('');
    this.shift.set('mañana');
    this.firstDataIncome.set(null);
    this.pedidosYaIncome.set(null);
    this.mercadoPagoIncome.set(null);
    this.dailySummary.set(null);
    this.cashEntries.set(structuredClone(DEFAULT_CASH_ENTRIES));
    this.expenses.set([{ detail: '', amount: null }]);
  }

  // --- TrackBy function for performance in @for loops ---
  trackByIndex(index: number, item: any): number {
    return index;
  }
}