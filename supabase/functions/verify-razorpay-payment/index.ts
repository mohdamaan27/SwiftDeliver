import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

function hexFromBuffer(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405 }
      );
    }

    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      } = await req.json();

      if (
        !razorpay_order_id ||
        !razorpay_payment_id ||
        !razorpay_signature
      ) {
        return Response.json(
          { error: "Missing Razorpay payment details" },
          { status: 400 }
        );
      }

      const keyId = Deno.env.get("RAZORPAY_KEY_ID");
      const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");

      if (!keyId || !keySecret) {
        console.error("Razorpay credentials are not configured.");

        return Response.json(
          { error: "Payment verification service is not configured" },
          { status: 500 }
        );
      }

      // --------------------------------------------------
      // 1. Verify Razorpay payment signature
      // --------------------------------------------------

      const payload =
        `${razorpay_order_id}|${razorpay_payment_id}`;

      const encoder = new TextEncoder();

      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        encoder.encode(keySecret),
        {
          name: "HMAC",
          hash: "SHA-256"
        },
        false,
        ["sign"]
      );

      const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        encoder.encode(payload)
      );

      const expectedSignature =
        hexFromBuffer(signatureBuffer);

      if (expectedSignature !== razorpay_signature) {
        console.warn("Invalid Razorpay payment signature.");

        return Response.json(
          {
            success: false,
            verified: false,
            error: "Invalid payment signature"
          },
          { status: 400 }
        );
      }

      // --------------------------------------------------
      // 2. Fetch the Razorpay order from Razorpay API
      // --------------------------------------------------

      const auth = btoa(`${keyId}:${keySecret}`);

      const orderResponse = await fetch(
        `https://api.razorpay.com/v1/orders/${encodeURIComponent(
          razorpay_order_id
        )}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Basic ${auth}`
          }
        }
      );

      const orderData = await orderResponse.json();

      if (!orderResponse.ok) {
        console.error(
          "Could not fetch Razorpay order:",
          orderData
        );

        return Response.json(
          {
            success: false,
            verified: false,
            error: "Could not verify Razorpay order"
          },
          { status: 400 }
        );
      }

      // --------------------------------------------------
      // 3. Check order amount and currency
      // --------------------------------------------------

      if (orderData.currency !== "INR") {
        return Response.json(
          {
            success: false,
            verified: false,
            error: "Invalid payment currency"
          },
          { status: 400 }
        );
      }

      if (!Number.isFinite(Number(orderData.amount)) || Number(orderData.amount) <= 0) {
        return Response.json(
          {
            success: false,
            verified: false,
            error: "Invalid Razorpay order amount"
          },
          { status: 400 }
        );
      }

      // --------------------------------------------------
      // 4. Fetch payments belonging to this Razorpay order
      // --------------------------------------------------

      const paymentsResponse = await fetch(
        `https://api.razorpay.com/v1/orders/${encodeURIComponent(
          razorpay_order_id
        )}/payments`,
        {
          method: "GET",
          headers: {
            "Authorization": `Basic ${auth}`
          }
        }
      );

      const paymentsData = await paymentsResponse.json();

      if (!paymentsResponse.ok) {
        console.error(
          "Could not fetch Razorpay payments:",
          paymentsData
        );

        return Response.json(
          {
            success: false,
            verified: false,
            error: "Could not verify payment status"
          },
          { status: 400 }
        );
      }

      // --------------------------------------------------
      // 5. Find the exact payment returned by Checkout
      // --------------------------------------------------

      const payment = (paymentsData.items || []).find(
        (item: any) => item.id === razorpay_payment_id
      );

      if (!payment) {
        console.warn(
          "Payment ID not found for order:",
          razorpay_payment_id
        );

        return Response.json(
          {
            success: false,
            verified: false,
            error: "Payment could not be found"
          },
          { status: 400 }
        );
      }

      // --------------------------------------------------
      // 6. Verify payment belongs to the correct order
      // --------------------------------------------------

      if (payment.order_id !== razorpay_order_id) {
        return Response.json(
          {
            success: false,
            verified: false,
            error: "Payment does not belong to this order"
          },
          { status: 400 }
        );
      }

      // --------------------------------------------------
      // 7. Verify amount and currency
      // --------------------------------------------------

      if (
        Number(payment.amount) !== Number(orderData.amount) ||
        payment.currency !== "INR"
      ) {
        console.warn(
          "Payment amount/currency mismatch:",
          {
            orderAmount: orderData.amount,
            paymentAmount: payment.amount,
            orderCurrency: orderData.currency,
            paymentCurrency: payment.currency
          }
        );

        return Response.json(
          {
            success: false,
            verified: false,
            error: "Payment amount or currency mismatch"
          },
          { status: 400 }
        );
      }

      // --------------------------------------------------
      // 8. Verify payment is actually captured
      // --------------------------------------------------

      if (
        payment.status !== "captured" ||
        payment.captured !== true
      ) {
        return Response.json(
          {
            success: false,
            verified: false,
            error: "Payment has not been captured"
          },
          { status: 400 }
        );
      }

      // --------------------------------------------------
      // 9. Everything passed
      // --------------------------------------------------

      console.log(
        "Razorpay payment fully verified:",
        razorpay_payment_id
      );

      return Response.json({
        success: true,
        verified: true,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status
      });

    } catch (error) {
      console.error(
        "Payment verification error:",
        error
      );

      return Response.json(
        {
          success: false,
          verified: false,
          error: "Unable to verify payment"
        },
        { status: 500 }
      );
    }
  }),
};