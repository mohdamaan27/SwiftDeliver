import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const calculateFee = (weight: unknown, priority: unknown) => {
  const baseFees: Record<string, number> = {
    standard: 60,
    express: 120,
    urgent: 250,
  };

  const base = baseFees[String(priority)] ?? 60;
  const w = Number(weight) || 0;

  if (w < 0 || w > 1000) {
    return null;
  }

  return Math.round(base + w * 18);
};

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405 }
      );
    }

    try {
      const { weight, priority, receipt, notes } = await req.json();

      if (!priority || !["standard", "express", "urgent"].includes(priority)) {
        return Response.json(
          { error: "Invalid delivery priority" },
          { status: 400 }
        );
      }

      const numericWeight = Number(weight);

      if (!Number.isFinite(numericWeight) || numericWeight < 0) {
        return Response.json(
          { error: "Invalid package weight" },
          { status: 400 }
        );
      }

      const fee = calculateFee(numericWeight, priority);

      if (fee === null) {
        return Response.json(
          { error: "Invalid package weight" },
          { status: 400 }
        );
      }

      // Razorpay expects INR in paise.
      const amountInPaise = fee * 100;

      const keyId = Deno.env.get("RAZORPAY_KEY_ID");
      const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");

      if (!keyId || !keySecret) {
        console.error("Razorpay credentials are not configured.");

        return Response.json(
          { error: "Payment service is not configured" },
          { status: 500 }
        );
      }

      const auth = btoa(`${keyId}:${keySecret}`);

      const razorpayResponse = await fetch(
        "https://api.razorpay.com/v1/orders",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Basic ${auth}`,
          },
          body: JSON.stringify({
            amount: amountInPaise,
            currency: "INR",
            receipt:
              receipt ||
              `swift_${Date.now()}_${Math.random()
                .toString(36)
                .slice(2, 8)}`,
            notes: {
              ...(notes || {}),
              priority: String(priority),
              weight: String(numericWeight),
              fee: String(fee),
            },
          }),
        }
      );

      const razorpayData = await razorpayResponse.json();

      if (!razorpayResponse.ok) {
        console.error(
          "Razorpay order creation failed:",
          razorpayData
        );

        return Response.json(
          {
            error:
              razorpayData?.error?.description ||
              "Could not create Razorpay order",
          },
          { status: razorpayResponse.status }
        );
      }

      return Response.json({
        success: true,
        fee,
        order: razorpayData,
        keyId,
      });

    } catch (error) {
      console.error("Create Razorpay order error:", error);

      return Response.json(
        { error: "Unable to create payment order" },
        { status: 500 }
      );
    }
  }),
};