export type CustomerPaymentMethod = "CASH" | "QRIS";

export type PaymentProvider = {
  name: string;
  mode: "manual" | "mock";
};

export const customerPaymentProviders: Record<CustomerPaymentMethod, PaymentProvider> = {
  CASH: { name: "manual_cash", mode: "manual" },
  QRIS: { name: "mock_qris", mode: "mock" },
};