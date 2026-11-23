// The control plane's streams are the shop's (apps/shop/routes/streams/[...path].ts). This app's
// pages read them at their own address, and the request goes on to the shop as it is, sign-in
// cookie included: the shop decides who may read what.
import { defineHandler } from "void";
import { toShop } from "../../src/user.ts";

export const GET = defineHandler((c) => toShop(c));
