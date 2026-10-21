export type Location = {
  slug: string;
  name: string;
  capital: string;
  lat: number;
  lon: number;
  // Listed in the 2026 national Annual Flood Outlook (NiHSA) high-risk states
  inOutlook: boolean;
};

// Not in the 2026 outlook's named list: Akwa Ibom, Ekiti, Katsina.
// Verify against the official NiHSA publication before relying on this flag.
const L = (
  name: string,
  capital: string,
  lat: number,
  lon: number,
  inOutlook = true,
): Location => ({
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  capital,
  lat,
  lon,
  inOutlook,
});

export const LOCATIONS: Location[] = [
  L("Abia", "Umuahia", 5.53, 7.49),
  L("Adamawa", "Yola", 9.2, 12.48),
  L("Akwa Ibom", "Uyo", 5.03, 7.93, false),
  L("Anambra", "Awka", 6.21, 7.07),
  L("Bauchi", "Bauchi", 10.31, 9.84),
  L("Bayelsa", "Yenagoa", 4.92, 6.26),
  L("Benue", "Makurdi", 7.73, 8.52),
  L("Borno", "Maiduguri", 11.83, 13.15),
  L("Cross River", "Calabar", 4.95, 8.33),
  L("Delta", "Asaba", 6.2, 6.73),
  L("Ebonyi", "Abakaliki", 6.32, 8.11),
  L("Edo", "Benin City", 6.34, 5.63),
  L("Ekiti", "Ado-Ekiti", 7.62, 5.22, false),
  L("Enugu", "Enugu", 6.46, 7.55),
  L("FCT", "Abuja", 9.06, 7.49),
  L("Gombe", "Gombe", 10.29, 11.17),
  L("Imo", "Owerri", 5.48, 7.03),
  L("Jigawa", "Dutse", 11.76, 9.34),
  L("Kaduna", "Kaduna", 10.52, 7.44),
  L("Kano", "Kano", 12.0, 8.52),
  L("Katsina", "Katsina", 12.99, 7.6, false),
  L("Kebbi", "Birnin Kebbi", 12.45, 4.2),
  L("Kogi", "Lokoja", 7.8, 6.74),
  L("Kwara", "Ilorin", 8.5, 4.55),
  L("Lagos", "Ikeja", 6.6, 3.35),
  L("Nasarawa", "Lafia", 8.49, 8.52),
  L("Niger", "Minna", 9.61, 6.55),
  L("Ogun", "Abeokuta", 7.16, 3.35),
  L("Ondo", "Akure", 7.25, 5.19),
  L("Osun", "Osogbo", 7.77, 4.56),
  L("Oyo", "Ibadan", 7.38, 3.95),
  L("Plateau", "Jos", 9.9, 8.86),
  L("Rivers", "Port Harcourt", 4.82, 7.05),
  L("Sokoto", "Sokoto", 13.06, 5.24),
  L("Taraba", "Jalingo", 8.89, 11.36),
  L("Yobe", "Damaturu", 11.75, 11.96),
  L("Zamfara", "Gusau", 12.17, 6.66),
];

export const bySlug = (slug: string) => LOCATIONS.find((l) => l.slug === slug);
