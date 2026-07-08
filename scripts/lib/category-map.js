// Maps a Google Places (New) `primaryType` value onto this app's real
// category taxonomy (books, restaurant, bakery/coffee, health, cars,
// groceries, hardware, bikes, shops) so newly-searched businesses get a
// sensible default the user can still override before adding.
// Full primaryType enum: https://developers.google.com/maps/documentation/places/web-service/place-types

const TYPE_TO_CATEGORY = {
  // books
  book_store: "books",
  library: "books",

  // restaurant
  restaurant: "restaurant",
  meal_takeaway: "restaurant",
  meal_delivery: "restaurant",
  fast_food_restaurant: "restaurant",
  pizza_restaurant: "restaurant",
  sandwich_shop: "restaurant",
  american_restaurant: "restaurant",
  mexican_restaurant: "restaurant",
  italian_restaurant: "restaurant",
  chinese_restaurant: "restaurant",
  japanese_restaurant: "restaurant",
  indian_restaurant: "restaurant",
  thai_restaurant: "restaurant",
  bar: "restaurant",
  ice_cream_shop: "restaurant",

  // bakery/coffee
  cafe: "bakery/coffee",
  coffee_shop: "bakery/coffee",
  bakery: "bakery/coffee",
  bagel_shop: "bakery/coffee",
  donut_shop: "bakery/coffee",

  // health
  pharmacy: "health",
  drugstore: "health",
  doctor: "health",
  dentist: "health",
  hospital: "health",
  physiotherapist: "health",
  hair_salon: "health",
  hair_care: "health",
  spa: "health",
  optician: "health",
  medical_lab: "health",

  // cars
  car_repair: "cars",
  car_dealer: "cars",
  car_wash: "cars",
  car_rental: "cars",
  gas_station: "cars",

  // groceries
  grocery_store: "groceries",
  grocery_or_supermarket: "groceries",
  supermarket: "groceries",
  convenience_store: "groceries",

  // hardware
  hardware_store: "hardware",
  home_improvement_store: "hardware",
  electrical_supply_store: "hardware",

  // bikes
  bicycle_store: "bikes",

  // shops (broad catch-all retail types)
  clothing_store: "shops",
  shoe_store: "shops",
  jewelry_store: "shops",
  gift_shop: "shops",
  florist: "shops",
  pet_store: "shops",
  book_binder: "shops",
  bank: "shops",
  atm: "shops",
};

const DEFAULT_CATEGORY = "shops";

export function mapPrimaryTypeToCategory(primaryType) {
  if (!primaryType) return DEFAULT_CATEGORY;
  return TYPE_TO_CATEGORY[primaryType] ?? DEFAULT_CATEGORY;
}
